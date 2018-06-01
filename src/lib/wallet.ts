import EventEmitter from "events";
import Node from "../index";
import logger from "./logger";
import { Options } from "./settings"
const noiaGovernance = require("noia-governance")
const extIP = require("external-ip")
const request = require("request")

const getIP = extIP({
  replace: true,
  services: [
    "http://icanhazip.com/",
    "http://ident.me/",
    "http://ifconfig.co/x-real-ip",
    "http://ifconfig.io/ip"
  ],
  timeout: 600,
  getIP: "parallel"
})

class Wallet extends EventEmitter {
  private ready: boolean = false
  private node: Node|null
  public address: string|undefined
  public nodeAddress: string|undefined
  public nodeRegistrationPassed: boolean

  constructor (node: Node|null, mnemonic: string, providerUrl: string) {
    super()
    this.nodeRegistrationPassed = false
    this.node = node

    if (this.node) {
      const skipBlockain = this.node.settings.get(Options.skipBlockchain)
      if (skipBlockain) {
        return
      }      
    }

    if (!mnemonic) {
      throw new Error("mnemonic is invalid")
    }

    if (!providerUrl) {
      const errorMsg = "setting: walletProviderUrl not found"
      logger.error(errorMsg)
      throw new Error(errorMsg)
    }
    
    noiaGovernance.init({
      account: {
        mnemonic: mnemonic
      },
      web3: {
        provider_url: providerUrl
      }
    })
      .then(() => {
        this.address = noiaGovernance.getOwnerAddress()
        this.ready = true
        this.emit("ready")
      })
      .catch((err: Error) => {
        logger.error(err)
      })
  }

  _ready (): Promise<void> {
    return new Promise((resolve) => {
      if (this.ready) {
        resolve()
      } else {
        this.once("ready", () => {
          resolve()
        })
      }
    })
  }

  getBalance (): Promise<number> {
    return new Promise((resolve) => {
      this._ready()
        .then(() => noiaGovernance.getNoiaBalance(this.address))
        .then((balance: number) => {
          logger.info(`wallet=${this.address}, balance(NOIA)=${balance}`)
          resolve(balance)
        })
        .catch((err: Error) => {
          logger.error("NOIA balance", err)
        })
    })
  }

  getEthBalance (): Promise<number> {
    return new Promise((resolve) => {
      this._ready()
        .then(() => noiaGovernance.getEtherBalance(this.address))
        .then((balance: number) => {
          logger.info(`wallet=${this.address}, balance(ETH)=${balance}`)
          resolve(balance)
        })
        .catch((err: Error) => {
          logger.error("ETH balance", err)
        })
    })
  }
 
  lazyNodeRegistration (nodeAddress?: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this._ready()
        .then(() => {
          if (this.nodeRegistrationPassed) {
            logger.info(`Skipping node lazy registration!`)
            return resolve(true)
          }
          if (nodeAddress) {
            logger.info(`Lazy wallet-address=${this.address} node-address=${nodeAddress} checking...`)
            this.isNodeRegistered(nodeAddress)
              .then((isRegistered) => {
                if (isRegistered) {
                  noiaGovernance.getNodeClient(nodeAddress)
                    .then((nodeClient: any) => nodeClient.getOwnerAddress())
                    .then((ownerAddress: string) => {
                      const isOwner = this.address === ownerAddress
                      if (isOwner) {
                        this.nodeRegistrationPassed = true
                        resolve(true)    
                      } else {
                        logger.warn(`node-address=${nodeAddress} belongs to other walllet, removing...`)
                        if (this.node) this.node.settings.remove(Options.client)
                        resolve(false)
                      }
                    })
                    .catch((err: Error) => {
                      throw new Error(err.message)
                    })
                } else {
                  logger.warn(`node-address=${nodeAddress} does not exist on blockchain`)
                  resolve(false)
                }
              })
              .catch(() => {
                resolve(false)
              })
          } else {
            logger.info(`Lazy node client for wallet-address=${this.address} registration...`)
            this.createNodeClientAddress()
              .then((nodeAddress) => {
                this.nodeRegistrationPassed = true
                resolve(true)
              })
              .catch(() => {
                if (this.node) this.node.wallet.earnTestEth()
                resolve(false)
              })
          }
        })
    })
  }

  isNodeRegistered (nodeAddress: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this._ready()
        .then(() => noiaGovernance.isNodeRegistered(nodeAddress))
        .then((isRegistered: boolean) => {
          logger.info(`node-client-address=${nodeAddress} is-registered=${isRegistered}`)
          resolve(isRegistered)
        })
        .catch((err: Error) => {
          logger.warn("Checking node registration", err)
          reject(err)
        })
    })
  }

  createNodeClientAddress (): Promise<string> {
    return new Promise((resolve, reject) => {
      this._ready()
        .then(() => {
          getIP((err: Error, ip: string) => {
            if (err) {
              logger.error(err)
              reject(err)
            }
            let nodeClientData: any = {}
            if (this.node && this.node.settings) {
              nodeClientData["interface"] = this.node.settings.get(Options.isHeadless) ? "terminal" : "gui"
              nodeClientData["node_ip"] = ip
              nodeClientData["node_ws_port"] = this.node.settings.get(Options.wsPort)
              nodeClientData["node_domain"] = this.node.settings.get(Options.domain)
            }
            logger.info("Creating node client...", nodeClientData)
            noiaGovernance.createNodeClient(nodeClientData)
              .then((nodeClient: any) => {
                if (this.node && this.node.settings) {
                  this.node.settings.update(Options.client, nodeClient.address)
                }
                resolve(nodeClient.address)
              })
              .catch((error: any) => {
                logger.warn("Create new node client", error)
                reject(error)
              })
          })
        })
        .catch((err: Error) => {
          logger.error("Create node client failed", err)
        })
    })
  }

  earnTestEth () {
    this._ready()
      .then(() => {
        logger.info(`Mining token (ETH_TEST) for address=${this.address}`)
        request(`http://faucet.ropsten.be:3001/donate/${this.address}`)
      })
      .catch((err: Error) => {
        logger.error("Earning ETH failed", err)
      })
  }

  listenForJobs () {
    this._ready()
      .then(() => {
        noiaGovernance.getBaseClient()
          .then((baseClient: any) => {
            baseClient.startWatchingJobPostAddedEvents({ pollingInterval: 1000 })
            logger.info("Listening for job posts...")
            baseClient.on("job_post_added", (jobPostAddress: string) => {
              logger.info(`job_post_added=${jobPostAddress}`)
              noiaGovernance.getJobPost(jobPostAddress)
                .then((jobPost: any) => {
                  logger.info(`Job post=${jobPost}`)
                  jobPost.owner().then((owner: any) => {
                    logger.info(owner)
                  })
                  logger.info()
                })
                .catch((err: Error) => {
                  logger.error("Failed to retrieve job post", err)
                })
            })
          })
          .catch((err: Error) => {
            logger.error("Error getting base client", err)
          })
      })
      .catch((err: Error) => {
        logger.error("Listening for jobs failed", err)
      })
  }

  findFirstJob () {
    return new Promise((resolve, reject) => {
      this._ready()
        .then(() => noiaGovernance.getBaseClient())
        .then((baseClient: any) => {
          baseClient.startWatchingJobPostAddedEvents({ pollingInterval: 1000 })
          logger.info("Listening for first job post...")
          baseClient.once("job_post_added", (jobPostAddress: string) => {
            noiaGovernance.getJobPost(jobPostAddress)
              .then((jobPost: any) => {
                jobPost.getEmployerAddress()
                  .then((businessClientAddress: string) => noiaGovernance.getBusinessClient(businessClientAddress))
                  .then((businessClient: any) => businessClient.getOwnerAddress())
                  .then((employerAddress: any) => {
                    const data = {
                      address: jobPost.address,
                      employerAddress: employerAddress,
                      info: jobPost.info
                    }
                    logger.info(`First found job`, data)
                    if (this.node) {
                      const whitelistMasters = this.node.settings.get(Options.whitelistMasters)
                      const foundMaster = whitelistMasters.find((hostname: string) => {
                        return data.info.host === hostname
                      })
                      if (Array.isArray(whitelistMasters) && whitelistMasters.length > 0 && !foundMaster) {
                        logger.warn(`Job hostname=${data.info.host} does not match whitelist criteria.`)
                        return this.findFirstJob()
                      }
                    }
                    resolve({
                      employerAddress: employerAddress,
                      info: jobPost.info
                    })
                  })
                  .catch((err: Error) => {
                    throw new Error(err.message)
                  })
              })
              .catch((err: Error) => {
                logger.error("Failed to retrieve job post", err)
                reject(err)
              })
          })
        })
        .catch((err: Error) => {
          logger.error("Finding first job failed", err)
        })
    })
  }

  signMessage (msg: string): Promise<string> {
    return new Promise((resolve, reject) => {
      noiaGovernance.getBaseClient()
        .then((baseClient: any) => baseClient.rpcSignMessage(msg))
        .then((msgSigned: string) => {
          logger.info(`Signed message`, { msg, msgSigned })
          resolve(msgSigned)
        })
        .catch((err: Error) => {
          reject(err)
        })
    })
  }

  recoverAddress (msg: string, msgSigned: string): string {
      const ownerAddress = noiaGovernance.recoverAddressFromRpcSignedMessage(msg, msgSigned)
      return ownerAddress
  }
}

export = Wallet
