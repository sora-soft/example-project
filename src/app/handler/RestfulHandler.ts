import {DatabaseComponent, EntityTarget, WhereBuilder, WhereCondition} from '@sora-soft/database-component';
import {Route, Service, Request} from '@sora-soft/framework';
import {ValidateClass, AssertType} from 'typescript-is';
import {AppErrorCode, UserErrorCode} from '../ErrorCode';
import {UserError} from '../UserError';
import {validate} from 'class-validator';
import {AccountWorld} from '../account/AccountWorld';
import {AuthGroupId} from '../account/AccountType';
import {AppError} from '../AppError';

export interface IRestfulHandlerCom<T = unknown> {
  name: string;
  com: DatabaseComponent;
  entity: EntityTarget<T>;
  select?: string[];
}

export type RestfulHandlerComList = IRestfulHandlerCom[];

export interface IReqFetch<T> {
  db: string;
  offset: number;
  limit: number;
  relations?: string[];
  order?: {
    [k: string]: -1 | 1;
  };
  select?: string[];
  where?: WhereCondition<T>;
}

export interface IReqUpdate<T> {
  data: Partial<T>;
  id: any;
  db: string;
}

export interface IReqUpdateBatch<T> {
  db: string;
  list: {
    id: any;
    data: Partial<T>;
  }[];
}

export interface IReqInsert<T> {
  db: string;
  data: Partial<T>;
}

export interface IReqInsertBatch<T> {
  db: string;
  list: Partial<T>[];
}

export interface IReqDeleteBatch {
  db: string;
  list: any[];
}

@ValidateClass()
class RestfulHandler extends Route {
  static async authChecker(gid: AuthGroupId, service: string, method: string, request: Request<{db: string}>) {
    const methodConvertMap = {
      fetch: 'fetch',
      insert: 'insert',
      insertBatch: 'insert',
      update: 'update',
      updateBatch: 'update',
      deleteBatch: 'delete',
    }
    const db = request.payload.db;
    return AccountWorld.hasAuth(gid, [service, methodConvertMap[method], db].join('.'));
  }

  constructor(service: Service, list: RestfulHandlerComList) {
    super(service);
    this.dbMap_ = new Map();
    for(const data of list) {
      this.dbMap_.set(data.name, data);
    }
  }

  @Route.method
  async fetch<T>(@AssertType() body: IReqFetch<T>) {
    const {com, entity, select} = this.getPair<T>(body.db);

    const finalSelect = select ? select : [];
    if (body.select && select) {
      body.select.forEach((key) => {
        if (select.includes(key))
          finalSelect.push(key);
      });
    }

    const where = WhereBuilder.build(body.where);
    const [list, total] = await com.manager.findAndCount(entity, {
      skip: body.offset,
      take: body.limit,
      relations: body.relations,
      order: body.order as any,
      select: finalSelect.length ? finalSelect as (keyof T)[] : undefined,
      where,
    });
    return {
      list,
      total,
    } as { list: Array<T>, total: number }
  }

  @Route.method
  async insert<T>(@AssertType() body: IReqInsert<T>) {
    const {com, entity} = this.getPair<T>(body.db);

    const data = await this.installData<T>(entity, body.data);

    const result = await com.manager.insert(entity, data).catch(err => {
      throw new AppError(AppErrorCode.ERR_DATABASE, err.message);
    });

    return result.raw as T;
  }

  @Route.method
  async insertBatch<T>(@AssertType() body: IReqInsertBatch<T>) {
    const {com, entity} = this.getPair<T>(body.db);

    const list: T[] = [];
    for (const d of body.list) {
      const data = await this.installData<T>(entity, d);
      list.push(data);
    }

    const result = await com.manager.save(list).catch(err => {
      throw new AppError(AppErrorCode.ERR_DATABASE, err.message);
    });

    return result;
  }

  @Route.method
  async update<T>(@AssertType() body: IReqUpdate<T>) {
    const {com, entity} = this.getPair(body.db);

    const data = await this.installData(entity, body.data);

    await com.manager.update(entity, body.id, data);

    return {};
  }

  @Route.method
  async updateBatch<T>(@AssertType() body: IReqUpdateBatch<T>) {
    const {com, entity} = this.getPair(body.db);

    await com.manager.transaction(async (manager) => {
      for (const d of body.list) {
        const data = await this.installData(entity, d.data);
        await manager.update(entity, d.id, data);
      }
    });

    return {};
  }

  @Route.method
  async deleteBatch<T>(@AssertType() body: IReqDeleteBatch) {
    const {com, entity} = this.getPair<T>(body.db);
    await com.manager.delete(entity, body.list);

    return {};
  }

  private getPair<T>(name: string) {
    const pair = this.dbMap_.get(name);
    if (!pair)
      throw new UserError(UserErrorCode.ERR_DB_NOT_FOUND, `ERR_DB_NOT_FOUND, db=${name}`);
    return pair as IRestfulHandlerCom<T>;
  }

  private async installData<T>(entity: any, data: any) {
    const result = new entity();
    for (const [key, value] of Object.entries(data)) {
      result[key] = value;
    }

    const errors = await validate(data);
    if (errors.length) {
      throw new UserError(UserErrorCode.ERR_PARAMETERS_INVALID, `ERR_PARAMETERS_INVALID, property=[${errors.map(e => e.property).join(',')}]`);
    }

    return result as T;
  }

  private dbMap_: Map<string, IRestfulHandlerCom>;
}


export {RestfulHandler}
