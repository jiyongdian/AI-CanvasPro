import { App } from 'antd';
import { useEffect } from 'react';

type ApiLike = Record<string, (...args: any[]) => any>;

let messageApi: ApiLike | null = null;
let modalApi: ApiLike | null = null;

const createApiProxy = <T extends ApiLike>(name: string, getter: () => T | null): T => new Proxy({} as T, {
  get(_target, prop) {
    return (...args: any[]) => {
      const api = getter();
      if (!api) {
        throw new Error(`antd ${name} api is not ready`);
      }
      const method = api[prop as keyof T];
      if (typeof method !== 'function') {
        return method;
      }
      return method(...args);
    };
  },
});

export const appMessage = createApiProxy<ApiLike>('message', () => messageApi);
export const appModal = createApiProxy<ApiLike>('modal', () => modalApi);

export const AntdAppBridge = () => {
  const api = App.useApp();

  useEffect(() => {
    messageApi = api.message as unknown as ApiLike;
    modalApi = api.modal as unknown as ApiLike;
  }, [api]);

  return null;
};
