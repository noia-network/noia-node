# README #

You would normally want to use [noia-node-gui][noia-node-gui] or [noia-node-terminal][noia-node-terminal].

#### Modules

| module | description |
|---|---|
| **[noia-node][noia-node]** | **core noia node (this module)**
| [noia-node-contents-client][noia-node-contents-client] | used to manage contents for noia-node
| `*`[noia-node-gui][noia-node-gui] | node graphical user interface
| `*`[noia-node-terminal][noia-node-terminal] | headless (terminal) node

`*` - example modules how to use noia-node internally and create headless or node with GUI.

[noia-node]: https://github.com/noia-network/noia-node
[noia-node-contents-client]: https://github.com/noia-network/noia-node-contents-client
[noia-node-gui]: https://github.com/noia-network/noia-node-gui
[noia-node-terminal]: https://github.com/noia-network/noia-node-terminal

#### Sample code

```javascript
console.log("[NODE]: Initializing...")
// Initialize node with default values
const node = new Node({
  settingsPath: "settings.json",
  ssl: true,
  privateKeyPath: "path/to/private.key",
  crtPath: "path/to/crt.cert",
  crtBundlePath: "path/to/crt-bundle.cert",
  // One option for test purposes is to use https://ropsten.infura.io infrastructure.
  walletProviderUrl: "https://example-wallet-provider.io/API_KEY"
})
console.log("[NODE]: initialized.")

// Setters take effect after restart
// node.setStorageSpace('/path/to/storage', 1048576)

// Events
node.on("started", () => {
  console.log("[NODE]: started.")
})
node.master.on("connected", () => {
  console.log("[NODE]: connected to master.")
})
node.master.on("closed", (info) => {
  if (info && info.code !== 1000) {
    console.log(`[NODE]: connection with master closed, info =`, info)
    node.restart()
  } else {
    console.log(`[NODE]: connection with master closed, normal exit`, info)
  }
})
node.master.on("cache", (info) => {
  console.log(`[NODE][IN]: cache request, resource = ${info.source.url}`)
})
node.master.on("clear", (info) => {
  console.log(`[NODE][IN]: clear request, infoHashes = ${info.infoHashes}`)
})
node.master.on("seed", (info) => {
  console.log("[NODE][IN]: seed request.")
})
if (node.clientSockets.http) {
  node.clientSockets.http.on("listening", (info) => {
    console.log(`[NODE]: listening for HTTP requests on port ${info.port}.`)
  })
  node.clientSockets.http.on("closed", () => {
  console.log(`[NODE]: closed HTTP server.`)
  })
}
if (node.clientSockets.ws) {
  node.clientSockets.ws.on("listening", (info) => {
    console.log(`[NODE]: listening for ${info.ssl ? "WSS" : "WS"} requests on port ${info.port}.`)
  })
  node.clientSockets.ws.on("closed", () => {
    console.log(`[NODE]: closed WS/WSS server.`)
  })
  node.clientSockets.ws.on("connections", (count) => {
    console.log(`[NODE]: WS Clients connections = ${count}`)
  })
}
node.contentsClient.on("seeding", (infoHashes) => {
  console.log("[NODE]: seeding contents: ", infoHashes)
})
node.clientSockets.on("resourceSent", (info) => {
  const client = `client ${info.ip}`
  const resource = `resource = ${info.resource.infoHash}`
  const url = `url = ${info.resource.url}`
  const size = `size = ${info.resource.size}`
  const sizeMB = `size = ${info.resource.size/1024/1024}`
  if (info.resource.url) {
    console.log(`[NODE]: HTTP sent to ${client} ${resource} ${sizeMB} ${url}`)
  } else {
    console.log(`[NODE]: WS sent to ${client} ${resource} ${sizeMB}`)
  }
})
node.on("destroyed", () => {
  console.log("[NODE]: stopped.")
})
node.on("error", (error) => {
  console.log("[NODE]: error =", error)
})

// Start
node.start()
```

# Configuration

Node configuration can be supplied to `Node` object or set via `settings.json` file. `settings.json` is generated on first run.

`*`required |`Node` options property | `settings.json` property | type | default | description |
|---|---|---|---|---| --- |
| no | settingsPath | N/A | string | ./settings.json | Path to `settings.json`.
| no | statisticsPath | N/A | string | ./statistics.json | Path to `statistics.json`.
| no | userDataPath | N/A | string | empty | Path to user user data folder. If specified, default `settings.json` and/or `statistics.json` will be saved to user data folder.
| no | isHeadless | isHeadless | boolean | true | False if node GUI.
| no | storageDir | storage.dir | string | ./storage | Path to storage directory.
| no | storageSize | storage.size | number | 104857600 | Size of disk space available to use for caching purposes.
| if ws | domain | domain | string | empty | Domain SSL is valid for.
| if ws | ssl | ssl | boolean | false | True to use secure connections.
| if ws | sslPrivateKeyPath | ssl.privateKeyPath | string | empty | Path to SSL private key.
| if ws | sslCrtPath | ssl.crtPath | string | empty | Path to certificate.
| if ws | sslCrtBundlePath | ssl.crtBundlePath | string | empty | Path to certificate bundle.
| no | publicIp | publicIp | string | empty | Public IP that master must use. If empty, master must resolve IP by itself.
| no | http | sockets.http | boolean | false | True to deliver content via HTTP protocol. 
| no | httpIp | sockets.http.ip | string | 0.0.0.0 | HTTP listening ip.
| no | httpPort | sockets.http.port | number | 6767 | HTTP listening port.
| no | ws | sockets.ws | boolean | false | True to deliver content via WebSockets protocol.
| no | wsIp | sockets.ws.ip | string | 0.0.0.0 | WS listening ip.
| no | wsPort | sockets.ws.port | number | 7676 | WS listening port.
| yes | wrtc | sockets.wrtc | boolean | true | True to deliver content via WebRTC.
| yes | wrtcControlPort | sockets.wrtc.control.port | number | 7677 | Control port to exchange SDP descriptions via HTTP.
| yes | wrtcControlIp | sockets.wrtc.control.ip | string | 0.0.0.0 | Control ip to exchange SDP descriptions via HTTP.
| yes | wrtcDataPort | sockets.wrtc.data.port | number | 7679 |  WebRTC data port.
| no | wrtcDataIp | sockets.wrtc.data.ip | string | undefined |  WebRTC data IP.
| no | walletMnemonic | wallet.mnemonic | string | generated | Wallet mnemonic.
| no | walletAddress | wallet.address | string | empty | Wallet address. If `skipBlockchain` is turned on this setting takes effect, else `walletMnemonic` is used to retrieve wallet address.
| if not skipBlockchain | walletProviderUrl | wallet.providerUrl | string | empty | Wallet provider url.
| no | client | client | string | empty | Node client address.
| if skipBlockchain | masterAddress | masterAddress | string | empty | Master address to connect to if skipping blockchain.
| no | whitelistMasters | whitelist.masters | array<string> | ["csl-masters.noia.network"] | Masters whitelist. If empty array then all masters addresses are available.
| no | controller | controller | boolean | false | RESTful node controller. Listens by default on 9000 port when turned on. |
| no | controllerIp | controllerIp | string | 127.0.0.1 | Node controller IP |
| no | controllerPort | controllerPort | string | 9000 | Node controller port |
| no | skipBlockchain | skipBlockchain | boolean | true | Connect directy to master using masterAddress (ignores whitelist) if turned on.
| no | nodeId | nodeId | string | generated | Node identifier if skipping blockchain.


`*` mandatory to make sure configuration is correct to connect to NOIA master and serve content using WebRTC protocol (default setup) or via secure WS (WebSockets). Currently HTTPS is not recommended and poorly supported.

**Note**: `skipBlockchain` is turned on by default while we develop blockchain network.

**Note**: On startup, node is registered on blockchain and client address (`client`) is saved in `settings.json`. If any of `domain`, `sockets.ws.port` or external IP information property changes, `client` should be regenerated. To do so, simply remove `client` property from `settings.json` and it will registern node client on blockchain with updated values.

### SSL

TODO: add SSL docs.

### Logging to log file

Node by default doesn't log activiy to file. To log to file `noia-node.log`, create `.env` file and add line `LOG_TO_FILE=yes` to enable it.
