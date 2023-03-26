export interface ConsumerNode<T> {
    next: ConsumerNode<T> | null;
    data: {
        value: T;
        done: boolean;
    };
}