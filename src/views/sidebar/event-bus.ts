/**
 * Per-SidebarView typed event bus.
 *
 * Domains publish notifications; ChatPresenter and cross-domain subscribers consume them.
 * Synchronous orchestration (e.g. SessionDomain calling AgentDomain.stream) does not use this bus.
 */

export type EventHandler<T = unknown> = (payload: T) => void;

export class EventBus<E extends Record<string, any> = Record<string, any>> {
	private handlers = new Map<keyof E, Set<EventHandler<E[keyof E]>>>();

	on<K extends keyof E>(event: K, handler: EventHandler<E[K]>): () => void {
		if (!this.handlers.has(event)) {
			this.handlers.set(event, new Set());
		}
		const set = this.handlers.get(event)!;
		const typedHandler = handler as EventHandler<E[keyof E]>;
		set.add(typedHandler);

		return () => {
			this.off(event, handler as EventHandler<E[K]>);
		};
	}

	off<K extends keyof E>(event: K, handler: EventHandler<E[K]>): void {
		const set = this.handlers.get(event);
		if (!set) return;
		set.delete(handler as EventHandler<E[keyof E]>);
		if (set.size === 0) {
			this.handlers.delete(event);
		}
	}

	emit<K extends keyof E>(event: K, payload: E[K]): void {
		const set = this.handlers.get(event);
		if (!set) return;
		for (const handler of set) {
			handler(payload);
		}
	}

	dispose(): void {
		this.handlers.clear();
	}
}
