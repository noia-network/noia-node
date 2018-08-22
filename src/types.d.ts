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
    interface Data {
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
    export = speedTestNet;
}

declare module "randombytes" {
    import { randomBytes } from "crypto";
    export = randomBytes;
}

declare module "logdna-winston";
declare module "swagger-ui-express";
declare module "external-ip";
declare module "@noia-network/governance";

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
