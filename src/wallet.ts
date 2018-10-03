import * as util from "util";
import EventEmitter from "events";
import request from "request";
import { NoiaSdk } from "@noia-network/governance";
import { WorkOrder } from "@noia-network/governance";
const noiaGovernance = new NoiaSdk();

import { Node } from "./node";
import { ProtocolEvent, SignedRequest } from "@noia-network/protocol";
import { SettingsEnum } from "./settings";
import { logger } from "./logger";

export interface JobPostDescription {
    employerWalletAddress: string;
    jobPostAddress: string;
    info: {
        host?: string;
        port?: number;
    };
    blockPosition?: string;
}

export class Wallet extends EventEmitter {
    private ready: boolean = false;
    private node: Node;
    public address: string | undefined;
    public nodeAddress: string | undefined;
    public nodeRegistrationPassed: boolean;
    public noiaBalance: number | undefined;
    private nextJob: any;

    constructor(node: Node, mnemonic: string, providerUrl: string) {
        super();
        this.nodeRegistrationPassed = false;
        this.node = node;

        if (this.node) {
            const skipBlockain = this.node.settings.options[SettingsEnum.skipBlockchain];
            if (skipBlockain) {
                return;
            }
        }

        if (!mnemonic) {
            throw new Error("mnemonic is invalid");
        }

        if (!providerUrl) {
            const errorMsg = "setting: walletProviderUrl not found";
            logger.error(errorMsg);
            throw new Error(errorMsg);
        }

        const initConfig = {
            account: {
                mnemonic: mnemonic
            },
            web3: {
                provider_url: providerUrl
            }
        };

        noiaGovernance
            .init(initConfig)
            .then(() => {
                this.address = noiaGovernance.getOwnerAddress();
                this.node.settings.update(SettingsEnum.walletAddress, this.address);
                this.ready = true;
                this.emit("ready");
            })
            .catch((err: Error) => {
                logger.error(String(err));
            });
    }

    private async _ready(): Promise<void> {
        return new Promise<void>(resolve => {
            if (this.ready) {
                resolve();
            } else {
                this.once("ready", () => {
                    resolve();
                });
            }
        });
    }

    public async getWorkOrder(workOrderAddress: string): Promise<WorkOrder> {
        await this._ready();
        const baseClient = await noiaGovernance.getBaseClient();
        const workOrder = await baseClient.getWorkOrderAt(workOrderAddress);
        logger.info(`Retrieved work order at ${workOrderAddress}.`);
        return workOrder;
    }

    public async getBalance(): Promise<number> {
        await this._ready();
        const balance = await noiaGovernance.getNoiaBalance(this.address as string);
        logger.info(`wallet=${this.address}, balance(NOIA)=${balance}`);
        return balance;
    }

    public async getEthBalance(): Promise<number> {
        await this._ready();
        const balance = noiaGovernance.getEtherBalance(this.address as string);
        logger.info(`wallet=${this.address}, balance(ETH)=${balance}`);
        return balance;
    }

    public async lazyNodeRegistration(nodeAddress?: string): Promise<boolean> {
        const doCreateClient = this.node.settings.options[SettingsEnum.doCreateClient];
        await this._ready();
        if (this.nodeRegistrationPassed) {
            logger.info(`Skipping node lazy registration!`);
            return true;
        }
        if (nodeAddress) {
            logger.info(`Lazy wallet-address=${this.address} node-address=${nodeAddress} checking...`);
            try {
                if (await this.isNodeRegistered(nodeAddress)) {
                    const nodeClient = await noiaGovernance.getNodeClient(nodeAddress);
                    const ownerAddress = nodeClient.getOwnerAddress();
                    if (this.address === ownerAddress) {
                        this.nodeRegistrationPassed = true;
                        return true;
                    } else {
                        logger.warn(`node-address=${nodeAddress} belongs to other walllet, removing...`);
                        this.node.settings.remove(SettingsEnum.client);
                        return false;
                    }
                } else {
                    logger.warn(`node-address=${nodeAddress} does not exist on blockchain`);
                    return false;
                }
            } catch (err) {
                logger.warn("Lazy node registration error:", err);
                return false;
            }
        } else {
            if (doCreateClient) {
                logger.info(`Lazy node client for wallet-address=${this.address} registration...`);
                try {
                    await this.createNodeClientAddress();
                    this.nodeRegistrationPassed = true;
                    return true;
                } catch (err) {
                    this.node.wallet.earnTestEth();
                    return false;
                }
            } else {
                logger.info(`Lazy node client for wallet-address=${this.address} registration skipped...`);
                return true;
            }
        }
    }

    private async isNodeRegistered(nodeAddress: string): Promise<boolean> {
        try {
            await this._ready();
            const isRegistered = await noiaGovernance.isNodeRegistered(nodeAddress);
            logger.info(`node-client-address=${nodeAddress} is-registered=${isRegistered}`);
            return isRegistered;
        } catch (err) {
            logger.warn("Error while checking node registration:", err);
            return false;
        }
    }

    private async createNodeClientAddress(): Promise<string> {
        logger.info("Creating node client...");
        try {
            await this._ready();
            const nodeClientData: any = {};
            // const ip = await Helpers.getIpPromise();
            // NodeBlockchainMetadata ?
            // nodeClientData["interface"] = this.node.settings.options[SettingsEnum.isHeadless] ? "terminal" : "gui";
            // nodeClientData["node_ip"] = ip;
            // nodeClientData["node_ws_port"] = this.node.settings.options[SettingsEnum.wsPort];
            // nodeClientData["node_domain"] = this.node.settings.options[SettingsEnum.domain];
            const nodeClient = await noiaGovernance.createNodeClient(nodeClientData);
            this.node.settings.update(SettingsEnum.client, nodeClient.address);
            return nodeClient.address;
        } catch (err) {
            logger.error("Error while creating node client address:", err);
            throw new Error(err);
        }
    }

    private async earnTestEth(): Promise<void> {
        logger.info(`Mining token (ETH_TEST) for address=${this.address}`);
        try {
            await this._ready();
            request(`http://faucet.ropsten.be:3001/donate/${this.address}`);
        } catch (err) {
            logger.error("Earning test ETH failed:", err);
        }
    }

    public async findNextJob(): Promise<JobPostDescription> {
        await this._ready();
        const workOrderAddress = this.node.settings.options[SettingsEnum.workOrder];
        logger.info(`Searching for next job post.. work-order-address=${workOrderAddress}.`);
        if (workOrderAddress != null && workOrderAddress !== "not-set") {
            const baseClient = await noiaGovernance.getBaseClient();
            const workOrder = await baseClient.getWorkOrderAt(workOrderAddress);
            const hasLockedTokens = await workOrder.hasTimelockedTokens();
            const jobPost = workOrder.getJobPost();
            logger.info(`Work order exists, has-locked-tokens: ${hasLockedTokens}`);
            if (hasLockedTokens) {
                const businessClientAddress = await jobPost.getEmployerAddress();
                const businessClient = await noiaGovernance.getBusinessClient(businessClientAddress);
                const employerWalletAddress = businessClient.getOwnerAddress();
                return {
                    employerWalletAddress: employerWalletAddress,
                    jobPostAddress: workOrder.getJobPost().address,
                    info: businessClient.info
                };
            }
        }

        // get a fresh new base client to pull in the next jobs
        let lastBlockNumber: number | undefined;
        let lastBlockIndex: number | undefined;
        if (this.node.settings.options[SettingsEnum.lastBlockPosition] != null) {
            const lastBlockPosition = this.node.settings.options[SettingsEnum.lastBlockPosition].split(":");
            lastBlockNumber = parseInt(lastBlockPosition[0]);
            lastBlockIndex = parseInt(lastBlockPosition[1]);
        }
        logger.info(`Last block position: last-block-number=${lastBlockNumber}, last-block-index: ${lastBlockIndex}.`);
        if (this.nextJob == null) {
            this.nextJob = {
                watcher: await noiaGovernance.getBaseClient()
            };
            const nextJobWatcher = this.nextJob.watcher;

            // Calculate the fromBlock based on current block.
            const latestBlock = await util.promisify(nextJobWatcher.web3.eth.getBlockNumber)();
            let fromBlock = latestBlock - 1000;
            if (fromBlock < 0) {
                fromBlock = 0;
            }

            if (lastBlockNumber != null) {
                fromBlock = lastBlockNumber;
            }

            // start polling
            logger.info(`Searching for a job starting from block=${fromBlock}.`);
            await nextJobWatcher.startWatchingJobPostAddedEvents({
                pullMode: true,
                pollingInterval: 1000,
                fromBlock: fromBlock
            });
        } else if (this.nextJob.resume) {
            // If polling has been paused then resume it.
            this.nextJob.resume();
            this.nextJob.resume = null;
        } else {
            throw new Error(`Next job polling is already active!`);
        }

        const watcher = this.nextJob.watcher;
        // Resolves when a suitable job post to work on is found.
        return new Promise<any>((resolve, reject) => {
            // Utility function to exit and clear up the resources.
            let timeoutId: NodeJS.Timer | null;
            const exit = (result: any, error: any, complete?: () => void) => {
                // clear the resources
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }

                // Stop the logs processing loop.
                if (typeof complete === "function") {
                    complete();
                }

                // Pause the watcher.
                this.nextJob.resume = watcher.stopWatchingJobPostAddedEvents();

                if (error) {
                    return reject(error);
                }
                resolve(result);
            };

            // Start the timer.
            const timeout = 5 * 60 * 1000; // 5 mins
            timeoutId = setTimeout(() => {
                exit(null, new Error(`Got timeout (${timeout / 1000}s) on finding the next job!`));
            }, timeout);

            // Start watching the new job post.
            logger.info(`Starting to listen next job post!`);
            watcher.on(
                "job_post_added",
                async (jobPostAddress: string, blockNumber: number, index: number, complete: (cont?: boolean) => void) => {
                    // if we have saved last block number and last log index inside that block number
                    // then we need to skip old incoming blocks
                    if (lastBlockNumber != null && lastBlockIndex != null) {
                        if (blockNumber < lastBlockNumber) {
                            logger.debug(
                                `Skip incoming job post: job-post-block-number=${blockNumber} < saved-last-block-number=${lastBlockNumber}`
                            );
                            return complete(true);
                        } else if (blockNumber === lastBlockNumber && index < lastBlockIndex) {
                            // do nothing because we are at the same block here than last time
                            // but incoming log index is smaller than the saved log index
                            logger.debug(
                                `Skip incoming job post: job-post-log-index=${index} < saved-last-log-index=${lastBlockIndex}` +
                                    ` for that same block=${blockNumber}.`
                            );
                            return complete(true);
                        }
                    }

                    try {
                        const jobPost = await noiaGovernance.getJobPost(jobPostAddress);
                        const businessClientAddress = await jobPost.getEmployerAddress();
                        const businessClient = await noiaGovernance.getBusinessClient(businessClientAddress);
                        const employerWalletAddress = businessClient.getOwnerAddress();
                        const data = {
                            address: jobPost.address,
                            employerWalletAddress: employerWalletAddress,
                            info: businessClient.info
                        };
                        logger.info(`Found first job post data:`, data);
                        const whitelistMasters = this.node.settings.options[SettingsEnum.whitelistMasters];
                        const foundMaster = whitelistMasters.find((hostname: string) => data.info.host === hostname);
                        if (Array.isArray(whitelistMasters) && whitelistMasters.length > 0 && !foundMaster) {
                            logger.warn(`Job hostname=${data.info.host} does not match whitelist criteria.`);
                            return this.findNextJob();
                        }
                        exit(
                            {
                                employerWalletAddress: employerWalletAddress,
                                jobPostAddress: jobPost.address,
                                info: businessClient.info,
                                blockPosition: `${blockNumber}:${index}`
                            },
                            null,
                            complete
                        );
                    } catch (err) {
                        logger.error("Failed to retrieve job post", err);
                        exit(null, err, complete);
                    }
                }
            );
        });
    }

    public async signMessage(msg: string): Promise<string> {
        await this._ready();
        const baseClient = await noiaGovernance.getBaseClient();
        const msgSigned = await baseClient.rpcSignMessage(msg);
        return msgSigned;
    }

    public recoverAddress(msg: string, msgSigned: string): string {
        const ownerAddress = noiaGovernance.recoverAddressFromRpcSignedMessage(msg, msgSigned);
        return ownerAddress;
    }

    public async doWork(workOrder: WorkOrder): Promise<void> {
        const timeLock = await workOrder.getTimelockedEarliest();
        logger.info(`Node is doing work: time-lock:${timeLock}.`);
        if (timeLock == null) {
            logger.error("No initial earliest time lock, disconnecting from master.");
            this.node.master.close();
            return;
        }
        const currentTimeSeconds = new Date().getTime() / 1000;
        let timeDiff = timeLock.until - currentTimeSeconds;
        timeDiff = timeDiff < 0 ? 0 : timeDiff;
        if (this.address == null) {
            throw new Error("Wallet address is invalid.");
        }
        const nonce = Date.now();
        const signedReleaseRequest = await workOrder.generateSignedReleaseRequest(this.address, nonce);
        const SAFETY_MARGIN_SECONDS = 5;
        this.noiaBalance = await this.getBalance();
        setTimeout(async () => {
            this.node.master.signedRequest({
                type: "release",
                beneficiary: this.address,
                signedRequest: signedReleaseRequest,
                workOrderAddress: workOrder.address,
                // @ts-ignore
                extendWorkOrder: true
            });
        }, (timeDiff + SAFETY_MARGIN_SECONDS) * 1000);
    }

    public async onWorkOrder(info: ProtocolEvent<WorkOrder>): Promise<void> {
        const workOrder = await this.getWorkOrder(info.data.address);
        const totalFunds = await workOrder.totalFunds();
        const totalVested = await workOrder.totalVested();
        logger.info(`Received work-order total-funds=${totalFunds.toNumber()} total-vested=${totalVested.toNumber()}`);
        if (totalFunds.toNumber() === 0) {
            logger.warn("Master doesn't have funds, disconnecting!");
            this.node.master.close();
        } else {
            this.node.settings.update(SettingsEnum.workOrder, workOrder.address);
            const hasLockedTokens = await workOrder.hasTimelockedTokens();
            if (hasLockedTokens && (await workOrder.isAccepted())) {
                this.doWork(workOrder);
            } else {
                const nonce = Date.now();
                const signedAcceptRequest = await workOrder.generateSignedAcceptRequest(nonce);
                this.node.master.signedRequest({
                    type: "accept",
                    signedRequest: signedAcceptRequest,
                    workOrderAddress: workOrder.address
                });
            }
        }
    }

    public async onReceivedSignedRequest(receivedSignedRequest: ProtocolEvent<SignedRequest>): Promise<void> {
        const workOrderAddress = this.node.settings.options[SettingsEnum.workOrder];
        const workOrder = await this.getWorkOrder(workOrderAddress);
        if (receivedSignedRequest.data.type === "accepted") {
            try {
                if (receivedSignedRequest.data.workOrderAddress !== workOrder.address) {
                    logger.error("Work order are not the same");
                    return;
                }
                logger.info("Work orders are the same.");
                if (!(await workOrder.isAccepted())) {
                    logger.error("Master did not actually accept work order");
                    return;
                }
                this.doWork(workOrder);
            } catch (err) {
                logger.error("Something went wrong", err);
            }
        } else if (receivedSignedRequest.data.type === "released") {
            logger.info("Signed request releases.");
            const currentBalance = await this.getBalance();
            if (this.noiaBalance == null) {
                throw new Error("cant happen");
            }
            const balanceDiff = currentBalance - this.noiaBalance;
            if (balanceDiff <= 0) {
                logger.error("NOIA balance didn't increase!");
                logger.info(`NODE earned ${balanceDiff}, current-balance=${currentBalance}`);
                return;
            }
            logger.info(`NODE earned ${balanceDiff}, current-balance=${currentBalance}`);
            try {
                if (receivedSignedRequest.data.workOrderAddress !== workOrder.address) {
                    logger.error("Work order are not the same");
                    return;
                }
                const timeLock = await workOrder.getTimelockedEarliest();
                logger.info("Time lock", timeLock);
                if (timeLock == null) {
                    this.node.settings.update(SettingsEnum.workOrder, "not-set");
                    logger.error("No more time locks, disconnecting from master and searching for new jobs...");
                    this.node.stop();
                    this.node.master.removeAllListeners("signedRequest");
                    setTimeout(() => {
                        this.node.start();
                    }, 5000);
                    return;
                }
                this.doWork(workOrder);
            } catch (err) {
                logger.error("Something went wrong while handling sign released request", err);
            }
        }
    }
}
