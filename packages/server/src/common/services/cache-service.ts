import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

class CacheServiceInvalidValueError extends Error {
	constructor(message: string) {
		super(message);
		this.name = this.constructor.name;
		Error.captureStackTrace(this, this.constructor);
	}
}

@Injectable()
export default class CacheService {

	readonly DEFAULT_EXPIRY = 5000;
	
	@Inject(CACHE_MANAGER) private cacheManager: Cache
	constructor() {}

	/**
	 * let nextStep1 = await this.cacheService.get(Step, step.id, async () => {
	 *  return await this.stepsService.lazyFindByID(step.id); 
	 * }, 10000);
	 * let nextStep2 = await this.cacheService.get(Step, step.id);
	 */
	async get(klass: any, id: string, callbackFn?: () => any, expiry: number = this.DEFAULT_EXPIRY): Promise<any> {
		const cacheKey = this.getCacheKey(klass, id);

		const result = await this.getRaw(cacheKey, callbackFn, expiry);

		return result;
	}

	async getIgnoreError(klass: any, id: string, callbackFn?: () => any, expiry: number = this.DEFAULT_EXPIRY): Promise<any> {
		let cacheKey: string;

		try {
			cacheKey = this.getCacheKey(klass, id);
		}
		catch(err) {
			if (err instanceof CacheServiceInvalidValueError) {
				return null;
			}
			else
				throw err;
		}

		const result = await this.getRaw(cacheKey, callbackFn, expiry);

		return result;
	}

	/**
	 * let value = await this.cacheService.getRaw("some-cache-key", async () => {
	 *  return await this.ApiService.client.getJsonValue("/index?limit=1");
	 * });
	 * let value = await this.cacheService.getRaw("some-cache-key");
	 */
	async getRaw(cacheKey: string, callbackFn?: () => any, expiry: number = this.DEFAULT_EXPIRY): Promise<any> {
		this.assertValue(cacheKey);

		const cachedValue: string = await this.cacheManager.get(cacheKey);

		if(!this.isBlank(cachedValue))
			return cachedValue;

		if(callbackFn) {
			const result = await callbackFn();

			await this.setRaw(cacheKey, result, expiry);

			return result;
		}
	}

	/**
	 * await this.cacheService.set(Step, step.id, async () => {
	 *  return await this.stepsService.lazyFindByID(step.id); 
	 * }, 10000);
	 */
	async set(klass: any, id: string, callbackFn: () => any, expiry: number = this.DEFAULT_EXPIRY) {
		const cacheKey = this.getCacheKey(klass, id);

		const result = callbackFn();

		await this.setRaw(cacheKey, result, expiry);
	}

	/**
	 * await this.cacheService.setRaw("some-cache-key", async () => {
	 *  return "hello-there";
	 * });
	 */
	async setRaw(cacheKey: string, value: any, expiry: number) {
		this.assertValue(cacheKey);

		await this.cacheManager.set(cacheKey, value, expiry);
	}

	private getCacheKey(klass: any, id: string): string {
		this.assertValue(id);

		return this.generateCacheKey(klass, id);
	}

	private generateCacheKey(klass: any, id: string): string {
		const key: string = `${this.getKlassName(klass)}:${id}`;

		return key;
	}

	private getKlassName(klass: any): string {
		const klass_name: string = klass.name ?? klass.constructor?.name;

		this.assertValue(klass_name)

		return klass_name;
	}

	private assertValue(str: string) {
		if(this.isBlank(str))
			throw new CacheServiceInvalidValueError(`${this.constructor.name} cannot access cache with empty value`);
	}

	private isBlank(str: string) {
		return str === undefined || str === null || str === "";
	}
}
