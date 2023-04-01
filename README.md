TopGunSocket
======

Client/Server modules for TopGunSocket.

## Client Setting up

To install this module:
```bash
npm install topgunsocket
```

## How to use client module

The socket-client script is called `socket-client.js` (located in the dist directory).
Embed it in your HTML page like this:
```html
<script type="text/javascript" src="/dist/socket-client.js"></script>
```
\* Note that the src attribute may be different depending on how you setup your HTTP server.

Once you have embedded the client `socket-client.js` into your page, you will gain access to a global `topGunSocketClient` object.
You may also use CommonJS `require` or ES6 module imports.

### Connect to a server

```js
let socket = topGunSocketClient.create({
  hostname: 'localhost',
  port: 8000
});
```

### Transmit data

```js
// Transmit some data to the server.
// It does not expect a response from the server.
// From the server socket, it can be handled using either:
// - for await (let data of socket.receiver('foo')) {}
// - let data = await socket.receiver('foo').once()
socket.transmit('foo', 123);
```

### Invoke an RPC

```js
(async () => {

  // Invoke an RPC on the server.
  // It expects a response from the server.
  // From the server socket, it can be handled using either:
  // - for await (let req of socket.procedure('myProc')) {}
  // - let req = await socket.procedure('myProc').once()
  let result = await socket.invoke('myProc', 123);

})();
```

### Subscribe to a channel

```js
(async () => {

  // Subscribe to a channel.
  let myChannel = socket.subscribe('myChannel');

  await myChannel.listener('subscribe').once();
  // myChannel.state is now 'subscribed'.

})();
```

### Get a channel without subscribing

```js
(async () => {

  let myChannel = socket.channel('myChannel');

  // Can subscribe to the channel later as a separate step.
  myChannel.subscribe();
  await myChannel.listener('subscribe').once();
  // myChannel.state is now 'subscribed'.

})();
```

### Publish data to a channel

```js
// Publish data to the channel.
myChannel.transmitPublish('This is a message');

// Publish data to the channel from the socket.
socket.transmitPublish('myChannel', 'This is a message');

(async () => {
  // Publish data to the channel and await for the message
  // to reach the server.
  try {
    await myChannel.invokePublish('This is a message');
  } catch (error) {
    // Handle error.
  }

  // Publish data to the channel from the socket and await for
  // the message to reach the server.
  try {
    await socket.invokePublish('myChannel', 'This is a message');
  } catch (error) {
    // Handle error.
  }
})();
```

### Consume data from a channel

```js
(async () => {

  for await (let data of myChannel) {
    // ...
  }

})();
```

### Connect over HTTPS:

```js
let options = {
  hostname: 'securedomain.com',
  secure: true,
  port: 443,
  rejectUnauthorized: false // Only necessary during debug if using a self-signed certificate
};
// Initiate the connection to the server
let socket = topGunSocketClient.create(options);
```

### Connect Options

```js
let options = {
  path: '/topgunsocket/',
  port: 8000,
  hostname: '127.0.0.1',
  autoConnect: true,
  secure: false,
  rejectUnauthorized: false,
  connectTimeout: 10000, //milliseconds
  ackTimeout: 10000, //milliseconds
  channelPrefix: null,
  disconnectOnUnload: true,
  autoReconnectOptions: {
    initialDelay: 10000, //milliseconds
    randomness: 10000, //milliseconds
    multiplier: 1.5, //decimal
    maxDelay: 60000 //milliseconds
  },
  authEngine: null,
  codecEngine: null,
  subscriptionRetryOptions: {},
  query: {
    yourparam: 'hello'
  }
};
```

## Compatibility mode

For compatibility with an existing TopGunSocket server, set the `protocolVersion` to `1` and make sure that the `path` matches your old server path:

```js
let socket = topGunSocketClient.create({
  protocolVersion: 1,
  path: '/topgunsocket/'
});
```

## How to use server module

You need to attach it to an existing Node.js http or https server (example) and pass wsEngine:
```js
const http = require('http');
const topGunSocketServer = require('topgun-socket/socket-server');
const ws = require('ws');

let httpServer = http.createServer();
let tgServer = topGunSocketServer.attach(httpServer, {
    path: '/topgunsocket/',
    wsEngine: ws.Server
});

(async () => {
  // Handle new inbound sockets.
  for await (let {socket} of tgServer.listener('connection')) {

    (async () => {
      // Set up a loop to handle and respond to RPCs for a procedure.
      for await (let req of socket.procedure('customProc')) {
        if (req.data.bad) {
          let error = new Error('Server failed to execute the procedure');
          error.name = 'BadCustomError';
          req.error(error);
        } else {
          req.end('Success');
        }
      }
    })();

    (async () => {
      // Set up a loop to handle remote transmitted events.
      for await (let data of socket.receiver('customRemoteEvent')) {
        // ...
      }
    })();

  }
})();

httpServer.listen(8000);
```

TopGunSocket can work without the `for-await-of` loop; a `while` loop with `await` statements can be used instead.

## Usage

### Consuming using async loops

```js
let demux = new StreamDemux();

(async () => {
  // Consume data from 'abc' stream.
  let substream = demux.stream('abc');
  for await (let packet of substream) {
    console.log('ABC:', packet);
  }
})();

(async () => {
  // Consume data from 'def' stream.
  let substream = demux.stream('def');
  for await (let packet of substream) {
    console.log('DEF:', packet);
  }
})();

(async () => {
  // Consume data from 'def' stream.
  // Can also work with a while loop for older environments.
  // Can have multiple loops consuming the same stream at
  // the same time.
  // Note that you can optionally pass a number n to the
  // createConsumer(n) method to force the iteration to
  // timeout after n milliseconds of inactivity.
  let consumer = demux.stream('def').createConsumer();
  while (true) {
    let packet = await consumer.next();
    if (packet.done) break;
    console.log('DEF (while loop):', packet.value);
  }
})();

(async () => {
  for (let i = 0; i < 10; i++) {
    await wait(10);
    demux.write('abc', 'message-abc-' + i);
    demux.write('def', 'message-def-' + i);
  }
  demux.close('abc');
  demux.close('def');
})();

// Utility function for using setTimeout() with async/await.
function wait(duration) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, duration);
  });
}
```

### Consuming using the once method

```js
// Log the next received packet from the abc stream.
(async () => {
  // The returned promise never times out.
  let packet = await demux.stream('abc').once();
  console.log('Packet:', packet);
})();

// Same as above, except with a timeout of 10 seconds.
(async () => {
  try {
    let packet = await demux.stream('abc').once(10000);
    console.log('Packet:', packet);
  } catch (err) {
    // If no packets are written to the 'abc' stream before
    // the timeout, an error will be thrown and handled here.
    // The err.name property will be 'TimeoutError'.
    console.log('Error:', err);
  }
})();
```

## Compatibility mode

For compatibility with existing TopGunSocket clients, set the `protocolVersion` to `1` and make sure that the `path` matches your old client path:

```js
let tgServer = topGunSocketClient.attach(httpServer, {
  protocolVersion: 1,
  path: '/topgunsocket/'
});
```

## Running the tests

- Clone this repo: `git clone git@github.com:TopGunBuild/topgun-socket.git`
- Navigate to project directory: `cd topgun-socket`
- Install all dependencies: `npm install`
- Run the tests: `npm test`

## Benefits of async `Iterable` over `EventEmitter`

- **More readable**: Code is written sequentially from top to bottom. It avoids event handler callback hell. It's also much easier to write and read complex integration test scenarios.
- **More succinct**: Event streams can be easily chained, filtered and combined using a declarative syntax (e.g. using async generators).
- **More manageable**: No need to remember to unbind listeners with `removeListener(...)`; just `break` out of the `for-await-of` loop to stop consuming. This also encourages a more declarative style of coding which reduces the likelihood of memory leaks and unintended side effects.
- **Less error-prone**: Each event/RPC/message can be processed sequentially in the same order that they were sent without missing any data; even if asynchronous calls are made inside middleware or listeners. On the other hand, with `EventEmitter`, the listener function for the same event cannot be prevented from running multiple times in parallel; also, asynchronous calls within middleware and listeners can affect the final order of actions; all this can cause unintended side effects.

## Reference

The code in this repository is based on ```socketcluster-server``` (https://github.com/SocketCluster/socketcluster-server) and ```socketcluster-client``` (https://github.com/SocketCluster/socketcluster-client). The code is written in typescript and is ready to run in a serverless environment.

## License

(The MIT License)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
