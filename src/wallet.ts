import * as util from "util";
import EventEmitter from "events";
import request from "request";
import { NoiaSdk } from "@noia-network/governance";
import { WorkOrder } from "@noia-network/governance";
import { validateMnemonic } from "bip39";
const noiaGovernance = new NoiaSdk();

import { Node } from "./node";
import { ProtocolEvent, SignedRequest } from "@noia-network/protocol";
import { logger } from "./logger";
import { BlockchainSettingsDto } from "@noia-network/node-settings/dist/settings/blockchain-settings";
import { SettingsScopeBase } from "@noia-network/node-settings";

interface BlockPosition {
    number?: number;
    index?: number;
}

export interface JobPostDescription {
    employerWalletAddress: string;
    jobPostAddress: string;
    info: {
        host?: string;
        port?: number;
    };
    blockPosition: string | null;
}

export enum BlockchainState {
    /**
     * Default state.
     */
    Initializing = "initializing",
    /**
     * Governance SDK is initialized.
     */
    Initialized = "initialized",
    /**
     * Checking saved work order.
     */
    CheckingSavedWorkOrder = "checking-saved-work-order",
    /**
     * Searching for a new job post.
     */
    SearchingForJobPost = "searching-for-job-post",
    /**
     * Working on a particular work order.
     */
    Working = "working"
}

export class Wallet extends EventEmitter {
    private ready: boolean = false;

    public state: BlockchainState = BlockchainState.Initializing;
    public nodeAddress: string | undefined;
    public nodeRegistrationPassed: boolean = false;
    public noiaBalance: number | undefined;
    private nextJob: any;
    private workTimeoutId?: NodeJS.Timer;
    private settings: SettingsScopeBase<BlockchainSettingsDto> = this.node.getSettings().getScope("blockchain");

    constructor(private readonly node: Node) {
        super();
        const walletMnemonic: string = this.settings.get("walletMnemonic");
        const providerUrl: string | null = this.settings.get("walletProviderUrl");

        if (!validateMnemonic(walletMnemonic)) {
            const msg = "Wallet mnemonic is not valid bip39 mnemonic. Use at your own risk.";
            logger.warn(msg);
            this.node.emit("warning", msg);
        }

        if (providerUrl == null) {
            const msg = `Wallet-provider-url=${providerUrl} is invalid. Please specify wallet provider url in settings.`;
            logger.error(msg);
            this.node.emit("error", new Error(msg));
            return;
        }

        const initConfig = {
            account: {
                mnemonic: walletMnemonic
            },
            web3: {
                provider_url: providerUrl
            }
        };

        noiaGovernance
            .init(initConfig)
            .then(async () => {
                await this.checkWorkOrder();
                this.ready = true;
                this.state = BlockchainState.Initialized;
                this.emit("ready");
            })
            .catch((err: Error) => {
                logger.error(String(err));
            });
    }

    public getOwnerAddress(): string {
        return noiaGovernance.getOwnerAddress();
    }

    private async _ready(): Promise<void> {
        return new Promise<void>(async resolve => {
            if (this.ready) {
                resolve();
            } else {
                this.once("ready", () => {
                    resolve();
                });
            }
        });
    }

    public cleanup(): void {
        if (this.workTimeoutId != null) {
            clearTimeout(this.workTimeoutId);
            this.workTimeoutId = undefined;
        }
        // Drop work order we were working on so it wont be attempted when finding new job.
        this.settings.reset("workOrderAddress");
    }

    public async getWorkOrder(workOrderAddress: string): Promise<WorkOrder> {
        await this._ready();
        const baseClient = await noiaGovernance.getBaseClient();
        const workOrder = await baseClient.getWorkOrderAt(workOrderAddress);
        return workOrder;
    }

    public async getBalance(): Promise<number> {
        await this._ready();
        const balance = await noiaGovernance.getNoiaBalance(this.getOwnerAddress());
        logger.info(`Current balance(NOIA)=${balance} of wallet=${this.getOwnerAddress()}.`);
        return balance;
    }

    public async getEthBalance(): Promise<number> {
        await this._ready();
        const balance = noiaGovernance.getEtherBalance(this.getOwnerAddress());
        logger.info(`Current balance(ETH)=${balance} of wallet=${this.getOwnerAddress()}.`);
        return balance;
    }

    public async lazyNodeRegistration(nodeAddress: string | null): Promise<boolean> {
        const doCreateClient = this.settings.get("doCreateClient");
        await this._ready();
        if (this.nodeRegistrationPassed) {
            logger.info(`Skipping node lazy registration!`);
            return true;
        }

        // If node address is set then check if it is valid (remove if not valid).
        // If node address is not set create new node client or skip creation.
        if (nodeAddress != null && nodeAddress !== "") {
            logger.info(`Lazy wallet-address=${this.getOwnerAddress()} node-address=${nodeAddress} checking...`);
            try {
                if (await this.isNodeRegistered(nodeAddress)) {
                    const nodeClient = await noiaGovernance.getNodeClient(nodeAddress);
                    const ownerAddress = await nodeClient.getOwnerAddress();
                    if (this.getOwnerAddress() === ownerAddress) {
                        this.nodeRegistrationPassed = true;
                        return true;
                    } else {
                        logger.warn(`Node node-address=${nodeAddress} belongs to other walllet, removing...`);
                        this.settings.reset("clientAddress");
                        return false;
                    }
                } else {
                    logger.warn(`Node node-address=${nodeAddress} does not exist on blockchain.`);
                    return false;
                }
            } catch (err) {
                logger.warn("Lazy node registration error:", err);
                return false;
            }
        } else {
            if (doCreateClient) {
                logger.info(`Node (wallet-address=${this.getOwnerAddress()}) is creating node client...`);
                try {
                    await this.createNodeClientAddress();
                    this.nodeRegistrationPassed = true;
                    return true;
                } catch (err) {
                    this.earnTestEth();
                    return false;
                }
            } else {
                logger.info(`Node (wallet-address=${this.getOwnerAddress()}) is not using node client.`);
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
            const nodeClient = await noiaGovernance.createNodeClient({});
            this.settings.update("clientAddress", nodeClient.address);
            return nodeClient.address;
        } catch (err) {
            logger.error("Error while creating node client address:", err);
            throw new Error(err);
        }
    }

    private async earnTestEth(): Promise<void> {
        logger.info(`Mining token (ETH_TEST) for address=${this.getOwnerAddress()}`);
        try {
            await this._ready();
            request(`http://faucet.ropsten.be:3001/donate/${this.getOwnerAddress()}`);
        } catch (err) {
            logger.error("Earning test ETH failed:", err);
        }
    }

    /**
     * Check if work order is retrievable from work address. If it is not - delete saved work order address from settings.
     */
    private async checkWorkOrder(): Promise<void> {
        const workOrderAddress = this.settings.get("workOrderAddress");

        // Check only if it is defined and potentially valid one.
        if (workOrderAddress == null || workOrderAddress === "") {
            return;
        }

        try {
            const baseClient = await noiaGovernance.getBaseClient();
            await baseClient.getWorkOrderAt(workOrderAddress);
        } catch (err) {
            logger.warn(`Work-order-address=${workOrderAddress} seemed to be invalid... removing.`);
            this.settings.reset("workOrderAddress");
        }
    }

    private getBlockStartPosition(latestBlock: number): BlockPosition {
        const settingsLastBlockPosition = this.settings.get("lastBlockPosition");
        if (settingsLastBlockPosition == null) {
            return {};
        }
        const lastBlockPosition = settingsLastBlockPosition.split(":");
        const blockPosition = {
            number: parseInt(lastBlockPosition[0]),
            index: parseInt(lastBlockPosition[1])
        };
        if (blockPosition.number > latestBlock) {
            this.settings.reset("lastBlockPosition");
            return {};
        }
        return blockPosition;
    }

    public async findNextJob(): Promise<JobPostDescription> {
        await this._ready();
        const workOrderAddress = this.settings.get("workOrderAddress");

        let attemptedSavedWorkOrder = false;
        if (workOrderAddress != null && workOrderAddress !== "") {
            this.state = BlockchainState.CheckingSavedWorkOrder;
            attemptedSavedWorkOrder = true;
            const baseClient = await noiaGovernance.getBaseClient();
            const workOrder = await baseClient.getWorkOrderAt(workOrderAddress);
            const hasLockedTokens = await workOrder.hasTimelockedTokens();
            const jobPost = workOrder.getJobPost();
            if (hasLockedTokens) {
                logger.info(`Using saved work-order-address=${workOrderAddress} with locked tokens.`);
                const businessClientAddress = await jobPost.getEmployerAddress();
                const businessClient = await noiaGovernance.getBusinessClient(businessClientAddress);
                const employerWalletAddress = await businessClient.getOwnerAddress();
                return {
                    employerWalletAddress: employerWalletAddress,
                    jobPostAddress: workOrder.getJobPost().address,
                    info: businessClient.info,
                    blockPosition: null
                };
            }
        }

        logger.info(`Scanning blockchain for new job post (attempted-saved-work-order=${attemptedSavedWorkOrder})... `);
        this.state = BlockchainState.SearchingForJobPost;
        // Get a fresh new base client to pull in the next jobs.
        let blockStartPosition: BlockPosition = {};
        if (this.nextJob == null) {
            this.nextJob = {
                watcher: await noiaGovernance.getBaseClient()
            };
            const nextJobWatcher = this.nextJob.watcher;

            // Calculate the fromBlock based on current block.
            const latestBlock = await util.promisify(nextJobWatcher.web3.eth.getBlockNumber)();
            blockStartPosition = this.getBlockStartPosition(latestBlock);
            logger.info(
                `Starting block position: last-block-number=${blockStartPosition.number}, last-block-index=${blockStartPosition.index}.`
            );

            let fromBlock = latestBlock - 1000 < 0 ? 0 : latestBlock - 1000;
            const blockStartPositionNumber = blockStartPosition.number;
            if (blockStartPositionNumber != null) {
                fromBlock = blockStartPositionNumber;
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
            const timeout = 2 * 60 * 1000; // 30 mins
            timeoutId = setTimeout(() => {
                exit(null, new Error(`Got timeout (${timeout / 1000}s) on finding the next job!`));
            }, timeout);

            // Start watching the new job post.
            logger.info(`Registering new job post event.`);
            watcher.on(
                "job_post_added",
                async (jobPostAddress: string, blockNumber: number, index: number, complete: (cont?: boolean) => void) => {
                    // If we have saved last block number and last log index inside that block number
                    // then we need to skip old incoming blocks
                    const lastBlockNumber = blockStartPosition.number;
                    const lastBlockIndex = blockStartPosition.index;
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
                        const employerWalletAddress = await businessClient.getOwnerAddress();
                        const data = {
                            address: jobPost.address,
                            employerWalletAddress: employerWalletAddress,
                            info: businessClient.info
                        };
                        logger.info(`Found first job post data:`, data);
                        const whitelistMasters = this.node
                            .getSettings()
                            .getScope("whitelist")
                            .get("masters");
                        const foundMaster = whitelistMasters.find((hostname: string) => data.info.host === hostname);
                        if (whitelistMasters[0] !== "*" && whitelistMasters.length > 0 && !foundMaster) {
                            const msg = `Job hostname=${data.info.host} does not match whitelist=${whitelistMasters}.`;
                            logger.warn(msg);
                            return exit(null, new Error(msg));
                            // return this.node.restart(15);
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
        if (timeLock == null) {
            logger.error("No initial earliest time lock, disconnecting from master.");
            this.node.getMaster().close();
            return;
        }
        this.state = BlockchainState.Working;
        const currentTimeSeconds = new Date().getTime() / 1000;
        let timeDiff = timeLock.until - currentTimeSeconds;
        timeDiff = timeDiff < 0 ? 0 : timeDiff;
        const nonce = Date.now();
        const signedReleaseRequest = await workOrder.generateSignedReleaseRequest(this.getOwnerAddress(), nonce);
        const SAFETY_MARGIN_SECONDS = 5;
        this.noiaBalance = await this.getBalance();
        logger.info(
            `Node is doing work: time-lock-amount=${timeLock.amount}, time-locked-until:${timeLock.until}, releasing in ${timeDiff +
                SAFETY_MARGIN_SECONDS} second(s).`
        );
        this.workTimeoutId = setTimeout(async () => {
            this.node.getMaster().signedRequest({
                type: "release",
                beneficiary: this.getOwnerAddress(),
                signedRequest: signedReleaseRequest,
                workOrderAddress: workOrder.address,
                extendWorkOrder: true
            });
        }, (timeDiff + SAFETY_MARGIN_SECONDS) * 1000);
    }

    public async onWorkOrder(info: ProtocolEvent<WorkOrder>): Promise<void> {
        const workOrder = await this.getWorkOrder(info.data.address);
        const totalFunds = await workOrder.totalFunds();
        const totalVested = await workOrder.totalVested();
        logger.info(
            `Received work order (work-order-address=${
                info.data.address
            }) total-funds=${totalFunds.toNumber()} total-vested=${totalVested.toNumber()}.`
        );
        if (totalFunds.toNumber() === 0) {
            logger.warn("Master doesn't have funds, disconnecting!");
            this.node.getMaster().close();
        } else {
            this.settings.update("workOrderAddress", workOrder.address);
            const hasLockedTokens = await workOrder.hasTimelockedTokens();
            if (hasLockedTokens && (await workOrder.isAccepted())) {
                this.doWork(workOrder);
            } else {
                const nonce = Date.now();
                const signedAcceptRequest = await workOrder.generateSignedAcceptRequest(nonce);
                this.node.getMaster().signedRequest({
                    type: "accept",
                    signedRequest: signedAcceptRequest,
                    workOrderAddress: workOrder.address
                });
            }
        }
    }

    public async onReceivedSignedRequest(receivedSignedRequest: ProtocolEvent<SignedRequest>): Promise<void> {
        const workOrderAddress = this.settings.get("workOrderAddress");
        if (workOrderAddress == null) {
            logger.error("Work order address is invalid!");
            return;
        }
        const workOrder = await this.getWorkOrder(workOrderAddress);
        if (receivedSignedRequest.data.type === "accepted") {
            try {
                if (receivedSignedRequest.data.workOrderAddress !== workOrder.address) {
                    logger.error(
                        `Compared work orders are not the same: received=${receivedSignedRequest.data.workOrderAddress} and saved=${
                            workOrder.address
                        }.`
                    );
                    return;
                }
                if (!(await workOrder.isAccepted())) {
                    logger.error("Master did not actually accept work order");
                    return;
                }
                this.doWork(workOrder);
            } catch (err) {
                logger.error("Something went wrong", err);
            }
        } else if (receivedSignedRequest.data.type === "released") {
            if (receivedSignedRequest.data.error != null) {
                throw new Error(receivedSignedRequest.data.error);
            }
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
                    logger.error(
                        `Compared work orders are not the same: received=${receivedSignedRequest.data.workOrderAddress} and saved=${
                            workOrder.address
                        }.`
                    );
                    return;
                }
                const timeLock = await workOrder.getTimelockedEarliest();
                logger.info("Time lock", timeLock);
                if (timeLock == null) {
                    this.settings.reset("workOrderAddress");
                    logger.error("No more time locks, disconnecting from master and searching for new jobs...");
                    this.node.stop();
                    this.node.getMaster().removeAllListeners("signedRequest");
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
