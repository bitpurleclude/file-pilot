import { handlers, type HandlerContext } from "./handler-registry.js";

export interface InMemoryIpc {
  invoke(channel: keyof typeof handlers, payload: Record<string, unknown>): Promise<unknown>;
}

export const createInMemoryIpc = (context: HandlerContext): InMemoryIpc => {
  return {
    invoke: async (channel, payload) => {
      const handler = handlers[channel];
      return handler(context, payload);
    }
  };
};
