export enum WebSocketCloseEvent {
    /**
     * Normal closure; the connection successfully completed whatever purpose for which it was created.
     */
    NormalClosure = 1000,
    /**
     * Used to indicate that a connection was closed abnormally (that is, with no close frame being sent) when a status code is expected.
     */
    AbnormalClosure = 1006,
    /**
     * The endpoint is terminating the connection because it received a message that violates its policy.
     */
    PolicyViolation = 1008,
    /**
     * The server is terminating the connection because it is restarting.
     */
    ServiceRestarting = 1012
}

export interface EnvConfig {
    /**
     * Flag to save log to file.
     */
    LOG_TO_FILE?: "yes" | "no";
    /**
     * LogDNA API key. If defined, then log should appear in LogDNA dashboard.
     */
    LOGDNA_API_KEY?: string;
    /**
     * LogDNA hostname. Helps to filter different processes.
     */
    LOGDNA_HOSTNAME?: string;
    /**
     * Message to send to master.
     */
    MSG?: string;
}

export interface ClientRequestData {
    contentId: string;
    offset: number;
    index: number;
}

export interface ClientResponseData {
    data?: {
        offset: number;
        index: number;
        buffer: Buffer;
    };
    error?: string;
    status: number;
}

export enum SocketType {
    Ws = "ws",
    Http = "http",
    WebRtc = "webrtc"
}

export interface ResourceSent {
    type: SocketType;
    ip: string;
    resource: {
        infoHash: string;
        size: number;
        /**
         * HTTP only.
         */
        url?: string;
    };
}

export interface SocketListening {
    type: SocketType;
    /**
     * HTTP, WS only.
     */
    port?: number;
    /**
     * HTTP, WS only.
     */
    ip?: string;
    /**
     * HTTP, WS only.
     */
    family?: string;
    /**
     * WS only.
     */
    ssl?: boolean;
}

export interface ClientSocketEvents {
    closed: (data: { type: SocketType }) => this;
    connections: (count: number) => this;
    error: (error: Error) => this;
    listening: (data: SocketListening) => this;
    resourceSent: (data: ResourceSent) => this;
}
