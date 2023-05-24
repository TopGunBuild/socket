<h1 align="center" style="border-bottom: none;">🚀 topgun-socket</h1>
<h3 align="center">Pub/sub and RPC toolkit for <a href="https://github.com/TopGunBuild/topgun">TopGun</a></h3>

<p align="center">
  <a href="https://github.com/semantic-release/semantic-release">
      <img alt="semantic-release" src="https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg">
  </a>
  <a href="https://npm.im/topgun-socket">
    <img alt="npm" src="https://badgen.net/npm/v/topgun-socket">
  </a>
  <a href="https://bundlephobia.com/result?p=topgun-socket">
    <img alt="bundlephobia" src="https://img.shields.io/bundlephobia/minzip/topgun-socket.svg">
  </a>
  <a href="https://opensource.org/licenses/MIT">
      <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg">
  </a>
  <a href="https://snyk.io/test/github/TopGunBuild/topgun">
        <img alt="Snyk" src="https://snyk.io/test/github/TopGunBuild/topgun/badge.svg">
    </a>
</p>

## Client Setting up

To install this module:

```bash
npm install topgun-socket
```

## How to use client module

The socket-client script is called `client.js`(ESM) or `client.global.js`(iife) (located in the dist directory).
Embed it in your HTML page like this:

```html
<script type="text/javascript" src="https://unpkg.com/topgun-socket@latest/dist/client.global.js"></script>
```

\* Note that the src attribute may be different depending on how you setup your HTTP server.

Once you have embedded the client `client.global.js` into your page, you will gain access to a global `TopGunSocket` object.
You may also use CommonJS `require` or ES6 module imports.

### Connect to a server

```js
let socket = TopGunSocket.create({
    hostname: "localhost",
    port: 8000,
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
myChannel.publish('This is a message');

// Publish data to the channel from the socket.
socket.publish('myChannel', 'This is a message');
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
let socket = TopGunSocket.create(options);
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
  multiplex: true,
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

For more detailed examples of how to use topgun-socket, see `test` folder.

## How to use server module

You need to attach it to an existing Node.js http or https server (example):
```js
const http = require('http');
const topGunSocketServer = require("topgun-socket/server");

let httpServer = http.createServer();
let agServer = topGunSocketServer.attach(httpServer);

(async () => {
  // Handle new inbound sockets.
  for await (let {socket} of agServer.listener('connection')) {

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

## Running the tests

-   Clone this repo: `git clone git@github.com:TopGunBuild/topgun-socket.git`
-   Navigate to project directory: `cd topgun-socket`
-   Install all dependencies: `npm install`
-   Run the tests: `npm test`

## Benefits of async `Iterable` over `EventEmitter`

-   **More readable**: Code is written sequentially from top to bottom. It avoids event handler callback hell. It's also much easier to write and read complex integration test scenarios.
-   **More succinct**: Event streams can be easily chained, filtered and combined using a declarative syntax (e.g. using async generators).
-   **More manageable**: No need to remember to unbind listeners with `removeListener(...)`; just `break` out of the `for-await-of` loop to stop consuming. This also encourages a more declarative style of coding which reduces the likelihood of memory leaks and unintended side effects.
-   **Less error-prone**: Each event/RPC/message can be processed sequentially in the same order that they were sent without missing any data; even if asynchronous calls are made inside middleware or listeners. On the other hand, with `EventEmitter`, the listener function for the same event cannot be prevented from running multiple times in parallel; also, asynchronous calls within middleware and listeners can affect the final order of actions; all this can cause unintended side effects.

## Reference

The code in this repository is based on `socketcluster-server` (https://github.com/SocketCluster/socketcluster-server) and `socketcluster-client` (https://github.com/SocketCluster/socketcluster-client). The code is written in typescript and is ready to run in a serverless environment.

## License

(The MIT License)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
