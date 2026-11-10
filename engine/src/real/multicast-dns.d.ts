declare module 'multicast-dns' {
  interface MdnsOptions {
    multicast?: boolean;
    interface?: string;
    port?: number;
    ip?: string;
    ttl?: number;
    loopback?: boolean;
  }

  interface MdnsPacket {
    questions?: Array<{ name: string; type: string }>;
    answers?: Array<Record<string, unknown>>;
    additionals?: Array<Record<string, unknown>>;
    authorities?: Array<Record<string, unknown>>;
  }

  interface MdnsInstance {
    on(event: 'query', listener: (packet: MdnsPacket) => void): this;
    on(event: 'response', listener: (packet: MdnsPacket) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    query(packet: MdnsPacket): void;
    respond(packet: MdnsPacket): void;
    destroy(): void;
  }

  function createMdns(options?: MdnsOptions): MdnsInstance;
  export = createMdns;
}
