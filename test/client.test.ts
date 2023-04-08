import { test, expectTypeOf } from 'vitest';
import { TGServerSocket } from '../src/socket-server';

test('simple', () =>
{
    expectTypeOf(TGServerSocket).toBeObject();
});
