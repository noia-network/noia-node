import ClientSockets from "./client-sockets";

it("should emit listening for http request", done => {
    const opts = {
        ws: false,
        http: {
            ip: "127.0.0.1",
            port: 6565
        }
    };

    // TODO: Should it be here null?
    const clientSockets = new ClientSockets(null as any, opts);
    clientSockets.http.on("listening", (info: any) => {
        if (info && info.type === "http" && info.ip === opts.http.ip && info.port === opts.http.port) {
            clientSockets.close();
            done();
        }
    });
    clientSockets.listen();
});

it("should emit closing for http request", done => {
    const opts = {
        ws: false,
        http: {
            ip: "127.0.0.1",
            port: 6565
        }
    };
    // TODO: Should it be here null?
    const clientSockets = new ClientSockets(null as any, opts);
    clientSockets.on("listening", (info: any) => {
        if (info && info.type === "http" && info.ip === opts.http.ip && info.port === opts.http.port) {
            clientSockets.close();
        }
    });
    // TODO: decide if keep info.
    // clientSockets.on("closed", (info) => {
    //   if (info && info.type === "http" && info.ip === opts.http.ip && info.port === opts.http.port) {
    //     done()
    //   }
    // })
    clientSockets.on("closed", () => done());
    clientSockets.listen();
});
