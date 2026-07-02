import { describe, it, expect, vi } from "vitest";
import { EventBus } from "@/views/sidebar/event-bus";

type TestEvents = {
	"test:event": { value: number };
	"test:other": { name: string };
};

describe("EventBus", () => {
	it("delivers emitted events to subscribers", () => {
		const bus = new EventBus<TestEvents>();
		const handler = vi.fn();

		bus.on("test:event", handler);
		bus.emit("test:event", { value: 42 });

		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith({ value: 42 });
	});

	it("does not notify a handler after it is removed", () => {
		const bus = new EventBus<TestEvents>();
		const handler = vi.fn();

		bus.on("test:event", handler);
		bus.off("test:event", handler);
		bus.emit("test:event", { value: 1 });

		expect(handler).not.toHaveBeenCalled();
	});

	it("returns an unsubscribe function from on()", () => {
		const bus = new EventBus<TestEvents>();
		const handler = vi.fn();

		const unsubscribe = bus.on("test:event", handler);
		unsubscribe();
		bus.emit("test:event", { value: 1 });

		expect(handler).not.toHaveBeenCalled();
	});

	it("supports multiple subscribers for the same event", () => {
		const bus = new EventBus<TestEvents>();
		const handlerA = vi.fn();
		const handlerB = vi.fn();

		bus.on("test:event", handlerA);
		bus.on("test:event", handlerB);
		bus.emit("test:event", { value: 7 });

		expect(handlerA).toHaveBeenCalledWith({ value: 7 });
		expect(handlerB).toHaveBeenCalledWith({ value: 7 });
	});

	it("does not deliver events to handlers registered for different event types", () => {
		const bus = new EventBus<TestEvents>();
		const handler = vi.fn();

		bus.on("test:other", handler);
		bus.emit("test:event", { value: 1 });

		expect(handler).not.toHaveBeenCalled();
	});

	it("removes all handlers on dispose", () => {
		const bus = new EventBus<TestEvents>();
		const handlerA = vi.fn();
		const handlerB = vi.fn();

		bus.on("test:event", handlerA);
		bus.on("test:other", handlerB);
		bus.dispose();
		bus.emit("test:event", { value: 1 });
		bus.emit("test:other", { name: "x" });

		expect(handlerA).not.toHaveBeenCalled();
		expect(handlerB).not.toHaveBeenCalled();
	});
});
