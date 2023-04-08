const http = require("http");
const topGunSocketServer = require("../dist/socket-server.js");
const ws = require("ws");

let httpServer = http.createServer();
let tgServer = topGunSocketServer.attach(httpServer, {
    path: "/topgunsocket/",
    wsEngine: ws.Server,
});

(async () => {
    // Handle new inbound sockets.
    for await (let { socket } of tgServer.listener("connection")) {
        (async () => {
            // Set up a loop to handle and respond to RPCs for a procedure.
            for await (let req of socket.procedure("customProc")) {
                if (req.data.bad) {
                    let error = new Error(
                        "Server failed to execute the procedure"
                    );
                    error.name = "BadCustomError";
                    req.error(error);
                } else {
                    req.end("Success");
                }
            }
        })();

        (async () => {
            // Set up a loop to handle remote transmitted events.
            for await (let data of socket.receiver("customRemoteEvent")) {
                // ...
                console.log(data);
            }
        })();
    }
})();

httpServer.listen(8000);
