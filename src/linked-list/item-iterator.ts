/**
 * Creates an iterator that iterates over a list (through an item).
 *
 * @template {Item} [T=Item]
 */
export class ItemIterator<T extends any>
{
    item: T|null = null;

    /**
     * Create a new iterator.
     *
     * @param {T|null} item
     */
    constructor(item: T|null)
    {
        /** @type {T|null} */
        this.item = item
    }

    /**
     * Move to the next item.
     *
     * @returns {IteratorResult<T, null>}
     */
    next(): IteratorResult<T|null>
    {
        const value = this.item;

        if (value)
        {
            this.item = value.next;
            return { value, done: false }
        }

        return { value: null, done: true }
    }
}