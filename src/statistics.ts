import { Statistics as ProtocolStatistics } from "@noia-network/protocol";
import { MasterConnectionState } from "./master";
import { Node } from "./node";

export class Statistics {
    constructor(node: Node) {
        setInterval(() => {
            if (node.getMaster().connectionState === MasterConnectionState.Connected) {
                if (this.uploaded != null && this.downloaded != null && this.totalTimeMs != null && this.syncTimestamp != null) {
                    const timestampDiff = new Date().getTime() - this.syncTimestamp;
                    node.getMaster().emit("statistics", {
                        downloaded: this.downloaded,
                        uploaded: this.uploaded,
                        time: this.msToTime(this.totalTimeMs + timestampDiff)
                    });
                }
            }
        }, 1 * 1000);
    }

    private uploaded: number | null = null;
    private downloaded: number | null = null;
    private totalTimeMs: number | null = null;
    private syncTimestamp: number | null = null;

    public sync(stats: ProtocolStatistics): void {
        this.uploaded = stats.uploaded;
        this.downloaded = stats.downloaded;
        this.totalTimeMs = stats.time.total;
        this.syncTimestamp = new Date().getTime();
    }

    protected msToTime(ms: number): { total: number; seconds: number; minutes: number; hours: number } {
        const timeInSeconds = Math.floor(ms / 1000);
        const seconds = Math.floor((timeInSeconds % 3600) % 60);
        const minutes = Math.floor((timeInSeconds % 3600) / 60);
        const hours = Math.floor(timeInSeconds / 3600);
        return {
            total: ms,
            seconds,
            hours,
            minutes
        };
    }
}
