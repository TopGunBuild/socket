/**
 * Double linked list.
 *
 * @template {Item} [T=Item]
 * @implements {Iterable<T>}
 */
import { ItemIterator } from './item-iterator';

export class List {
    /**
     * Create a new `this` from the given array of items.
     *
     * Ignores `null` or `undefined` values.
     * Throws an error when a given item has no `detach`, `append`, or `prepend`
     * methods.
     *
     * @template {Item} [T=Item]
     * @param {Array<T|null|undefined>} [items]
     */
    static from(items) {
        /** @type {List<T>} */
        const list = new this()
        return appendAll(list, items)
    }

    /**
     * Create a new `this` from the given arguments.
     *
     * Ignores `null` or `undefined` values.
     * Throws an error when a given item has no `detach`, `append`, or `prepend`
     * methods.
     *
     * @template {Item} [T=Item]
     * @param {Array<T|null|undefined>} items
     * @returns {List<T>}
     */
    static of(...items) {
        /** @type {List<T>} */
        const list = new this()
        return appendAll(list, items)
    }

    /**
     * Create a new list from the given items.
     *
     * Ignores `null` or `undefined` values.
     * Throws an error when a given item has no `detach`, `append`, or `prepend`
     * methods.
     *
     * @param {Array<T|null|undefined>} items
     */
    constructor(...items) {
        /* eslint-disable no-unused-expressions */
        /**
         * The number of items in the list.
         *
         * @type {number}
         */
        this.size

        /**
         * The first item in a list or `null` otherwise.
         *
         * @type {T|null}
         */
        this.head

        /**
         * The last item in a list and `null` otherwise.
         *
         * > 👉 **Note**: a list with only one item has **no tail**, only a head.
         *
         * @type {T|null}
         */
        this.tail
        /* eslint-enable no-unused-expressions */

        appendAll(this, items)
    }

    /**
     * Append an item to a list.
     *
     * Throws an error when the given item has no `detach`, `append`, or `prepend`
     * methods.
     * Returns the given item.
     *
     * @param {T|null|undefined} [item]
     * @returns {T|false}
     */
    append(item) {
        if (!item) {
            return false
        }

        if (!item.append || !item.prepend || !item.detach) {
            throw new Error(
                'An argument without append, prepend, or detach methods was given to `List#append`.'
            )
        }

        // If self has a last item, defer appending to the last items append method,
        // and return the result.
        if (this.tail) {
            return this.tail.append(item)
        }

        // If self has a first item, defer appending to the first items append method,
        // and return the result.
        if (this.head) {
            return this.head.append(item)
        }

        // …otherwise, there is no `tail` or `head` item yet.
        item.detach()
        item.list = this
        this.head = item
        this.size++

        return item
    }

    /**
     * Prepend an item to a list.
     *
     * Throws an error when the given item has no `detach`, `append`, or `prepend`
     * methods.
     * Returns the given item.
     *
     * @param {T|null|undefined} [item]
     * @returns {T|false}
     */
    prepend(item) {
        if (!item) {
            return false
        }

        if (!item.append || !item.prepend || !item.detach) {
            throw new Error(
                'An argument without append, prepend, or detach methods was given to `List#prepend`.'
            )
        }

        if (this.head) {
            return this.head.prepend(item)
        }

        item.detach()
        item.list = this
        this.head = item
        this.size++

        return item
    }

    /**
     * Returns the items of the list as an array.
     *
     * This does *not* detach the items.
     *
     * > **Note**: `List` also implements an iterator.
     * > That means you can also do `[...list]` to get an array.
     */
    toArray() {
        let item = this.head
        /** @type {Array<T>} */
        const result = []

        while (item) {
            result.push(item)
            item = item.next
        }

        return result
    }

    /**
     * Creates an iterator from the list.
     *
     * @returns {ItemIterator<T>}
     */
    [Symbol.iterator]() {
        return new ItemIterator(this.head)
    }
}
