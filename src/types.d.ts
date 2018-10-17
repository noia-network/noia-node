declare module "default-gateway" {
    interface gateway {
        interface: any;
        gateway: any;
    }

    const v4: {
        sync: () => gateway;
    };
}

declare module "nat-pmp" {
    interface PortMappingOpts {
        private: number;
        public: number;
        ttl: number;
        type: string;
    }

    interface MappingInfo {
        msg: Buffer;
        vers: number;
        op: number;
        resultCode: number;
        resultMessage: string;
        epoch: number;
        internal: number;
        private: number;
        external: number;
        public: number;
        ttl: number;
        type: string;
    }

    export interface Client {
        portMapping(opts: PortMappingOpts, cb: (err: Error, info: MappingInfo) => void): void;
    }

    export function connect(gateway: string): Client;
}

declare module "speedtest-net" {
    export interface Data {
        speeds: {
            download: number;
            upload: number;
            originalDownload: number;
            originalUpload: number;
        };
        client: {
            ip: string;
            lat: number;
            lon: number;
            isp: string;
            isprating: number;
            rating: number;
            ispdlavg: number;
            ispulavg: number;
            country: string;
        };
        server: {
            host: string;
            lat: number;
            lon: number;
            location: string;
            country: string;
            cc: string;
            sponsor: string;
            distance: number;
            distanceMi: number;
            ping: number;
            id: string;
        };
    }
    interface SpeedTest {
        on(event: "data", listener: (data: Data) => void): this;
        on(event: "error", listener: (error: Error) => void): this;
    }
    function speedTestNet(options?: { [key: string]: string | number }): SpeedTest;
    export default speedTestNet;
}

declare module "randombytes" {
    import { randomBytes } from "crypto";
    export = randomBytes;
}

declare module "logdna-winston";
declare module "swagger-ui-express";
declare module "external-ip";
declare module "@noia-network/governance" {
    interface InitOptions {
        account: { mnemonic: string };
        web3: { provider_url: string };
    }
    interface BusinessClientData {
        host: string;
        port: number;
    }
    interface JobPostOptions {}
    interface NodeClientData {}

    export class NoiaSdk {
        init(initOptions: InitOptions): Promise<void>;
        getOwnerAddress(): string;
        isBusinessRegistered(businessClient: string): Promise<boolean>;
        getBusinessClient(businessClientAddress: string): Promise<BusinessClient>;
        createBusinessClient(businessClientData: BusinessClientData): Promise<BusinessClient>;
        getEtherBalance(ownerAddress: string): Promise<number>;
        getNoiaBalance(ownerAddress: string): Promise<number>;
        transfer(from: string, to: string, amount: number): Promise<void>;
        transferNoiaToken(workOrderAddress: string, amountWeis: number): Promise<void>;
        isNodeRegistered(nodeClientAddress: string): Promise<boolean>;
        getNodeClient(nodeClientAddress: string): Promise<NodeClient>;
        recoverAddressFromRpcSignedMessage(msg: string, msgSigned: string): string;
        getBaseClient(): Promise<BaseClient>;
        getJobPost(jobPostAddress: string): Promise<JobPost>;
        noiaTokensToWeis(amountNoia: number): number;
        createNodeClient(nodeClientData: NodeClientData): Promise<NodeClient>;
    }

    class BigNumber {
        constructor(amount: string);
    }
    export class WorkOrder {
        accept(): Promise<void>;
        address: string;
        getWorkerOwner(): Promise<string>;
        delegatedAccept(nonce: number, sig: string): Promise<void>;
        delegatedRelease(beneficiary: string, nonce: number, sig: string): Promise<void>;
        generateSignedAcceptRequest(nonce: number): Promise<any>;
        generateSignedReleaseRequest(walletAddress: string, nonce: number): Promise<any>;
        getTimelockedEarliest(): Promise<any>;
        hasTimelockedTokens(): Promise<boolean>;
        isAccepted(): Promise<boolean>;
        timelock(amount: BigNumber, time: number): Promise<any>;
        totalFunds(): Promise<{ toNumber: () => number }>;
        totalVested(): Promise<{ toNumber: () => number }>;
        getJobPost(): JobPost;
    }
    export class BaseClient {
        rpcSignMessage(msg: string): Promise<string>;
        getWorkOrderAt(workOrderAddress: string): Promise<WorkOrder>;
    }
    export class NodeClient {
        address: string;
        getOwnerAddress(): Promise<string>;
    }
    export class BusinessClient {
        address: string;
        info: BusinessClientData;
        createJobPost(jobPostOptions: JobPostOptions): Promise<JobPost>;
        getOwnerAddress(): Promise<string>;
    }
    class JobPost {
        address: string;
        getEmployerAddress(): Promise<string>;
        getWorkOrderAt(workOrderAddress: string): Promise<WorkOrder>;
        createWorkOrder(workOrderAddress: string): Promise<WorkOrder>;
    }
}

// FIXME: actually import "wrtc"
declare module "wrtc" {
    export interface RTCPeerConnectionIceEvent extends Event {
        readonly candidate: IceCandidate;
    }

    export interface IceCandidate {
        sdpMLineIndex: number | null;
        candidate: string | null;
    }

    export interface Description {}

    export interface DataChannel extends EventTarget {
        onmessage: (event: MessageEvent) => void;
        onopen: (event: Event) => void;
        send: (data: any) => void;
    }

    export class RTCSessionDescription {
        constructor(desc: RTCSessionDescriptionInit);
    }

    interface handleErrorCallback {
        (error: ErrorEvent): void;
    }

    interface setLocalDescriptionFn {
        (rtcSD: RTCSessionDescription, successCallback: () => void, handleError: handleErrorCallback): void;
    }

    export class RTCPeerConnection extends EventTarget {
        signalingState: string;
        iceConnectionState: string;
        iceGatheringState: string;
        connectionState: string;
        localDescription: RTCSessionDescriptionInit;
        remoteDescription: RTCSessionDescriptionInit;

        onerror: (event: ErrorEvent) => void;
        onnegotationneeded: (event: Event) => void;
        onicecandidateerror: (event: Event) => void;
        onsignalingstatechange: (event: Event) => void;
        oniceconnectionstatechange: (event: Event) => void;
        onicegatheringstatechange: (event: Event) => void;
        onconnectionstatechange: (event: Event) => void;
        onicecandidate: (candidate: RTCPeerConnectionIceEvent) => void;

        addIceCandidate: (candidate: RTCIceCandidate) => void;
        setRemoteDescription: (rtcSD: RTCSessionDescription, successCallback: () => void, handleError: handleErrorCallback) => void;
        setLocalDescription: setLocalDescriptionFn;
        createOffer: (setLocalDescription: setLocalDescriptionFn, handleError: handleErrorCallback) => void;
        createDataChannel: (name: string) => DataChannel;
        close: () => void;
    }

    export class RTCIceCandidate {
        constructor(iceCandidate: IceCandidate);
    }
}
