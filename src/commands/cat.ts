import {
    HttpClient,
    ordersChannelFactory,
    OrdersChannelHandler,
    SignedOrder,
} from '@0x/connect';
import { WSClient } from '@0x/mesh-rpc-client';
import { APIOrder, AssetPairsItem } from '@0x/types';
import { Command, flags } from '@oclif/command';
import * as _ from 'lodash';

// tslint:disable-next-line:no-var-requires
const d = require('debug');

const DEFAULT_PULL_DELAY = 1000;
const DEFAULT_PULL_RETRIES = 20;
const MIN_ORDERBOOK_SIZE = 2;
const delay = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

const attempt = async <T>(
    fn: () => Promise<T>,
    opts: { interval: number; maxRetries: number } = {
        interval: DEFAULT_PULL_DELAY,
        maxRetries: DEFAULT_PULL_RETRIES,
    },
) => {
    let result: T | undefined;
    let currentAttempt = 1;
    let error;
    while (!result && currentAttempt <= opts.maxRetries) {
        currentAttempt++;
        try {
            result = await fn();
        } catch (err) {
            d('attempt')(new Date(), currentAttempt, err.message);
            error = err;
            await delay(opts.interval * currentAttempt + opts.interval);
        }
    }
    if (result) {
        return result;
    }
    throw new Error(error);
};

export class Cat extends Command {
    public static description = 'Call the Ethereum transaction';

    public static examples = [`$ 0x-relayer-cat cat`];

    public static flags = {
        help: flags.help({ char: 'h' }),
        httpEndpoint: flags.string({
            char: 'e',
            description: 'SRA HTTP endpoint of the Relayer',
            default: 'https://api.radarrelay.com/0x/v3',
            required: true,
        }),
        wsEndpoint: flags.string({
            char: 'w',
            description: 'SRA WebSocket endpoint of the Relayer',
            default: 'wss://ws.radarrelay.com/0x/v3',
            required: true,
        }),
        assetDataA: flags.string({
            description: 'asset data',
        }),
        assetDataB: flags.string({
            description: 'asset data',
        }),
        makerAddress: flags.string({
            description: 'Maker address',
        }),
        toSRA: flags.string({
            description: 'SRA Endpoint to forward to',
        }),
        toMesh: flags.string({
            description: 'Mesh Endpoint to forward to',
        }),
        pushDelay: flags.integer({
            description:
                'Delay in milliseconds before pushing to mesh (allows for batching)',
        }),
        pullDelay: flags.integer({
            description:
                'Delay in milliseconds between pulling from SRA endpoint orderbooks',
            default: DEFAULT_PULL_DELAY,
            required: true,
        }),
    };

    public static args = [];
    private _sraClient!: HttpClient;
    private _meshClient!: WSClient;
    private _pendingMeshOrders: SignedOrder[] = [];
    private _meshPushIntervalId?: NodeJS.Timeout;
    private _pullDelay: number = DEFAULT_PULL_DELAY;
    // tslint:disable-next-line:async-suffix
    public async run(): Promise<void> {
        // tslint:disable-next-line:no-shadowed-variable
        const { args, flags } = this.parse(Cat);
        const { httpEndpoint, wsEndpoint, assetDataA, assetDataB } = flags;
        d('flags')(flags);
        if (flags.toSRA) {
            this._sraClient = new HttpClient(flags.toSRA);
        }
        if (flags.toMesh) {
            this._meshClient = new WSClient(flags.toMesh);
        }
        this._pullDelay = flags.pullDelay;
        this._connectAsync(httpEndpoint, wsEndpoint, assetDataA, assetDataB);
    }
    private _ordersReceived(orders: SignedOrder[]): void {
        // tslint:disable-next-line:no-shadowed-variable
        const { flags } = this.parse(Cat);
        const { makerAddress } = flags;
        const filteredOrders = makerAddress
            ? orders.filter(o => o.makerAddress === makerAddress.toLowerCase())
            : orders;
        if (flags.toSRA) {
            for (const order of filteredOrders) {
                try {
                    void this._sraClient.submitOrderAsync(order);
                } catch (e) {
                    d('sra')(e.message);
                }
            }
        } else if (flags.toMesh) {
            void this._pushOrdersToMeshAsync(filteredOrders);
        } else {
            for (const order of filteredOrders) {
                console.log(JSON.stringify(order));
            }
        }
    }
    private async _pushOrdersToMeshAsync(orders: SignedOrder[]): Promise<void> {
        // tslint:disable-next-line:no-shadowed-variable
        const { flags } = this.parse(Cat);
        if (flags.pushDelay) {
            this._pendingMeshOrders = [...this._pendingMeshOrders, ...orders];
            if (!this._meshPushIntervalId) {
                this._meshPushIntervalId = setInterval(async () => {
                    if (this._pendingMeshOrders.length > 0) {
                        const localOrders = [...this._pendingMeshOrders];
                        this._pendingMeshOrders = [];
                        const response = await attempt(() =>
                            this._meshClient.addOrdersAsync(localOrders),
                        );
                        d('mesh')(
                            `MESH response: ${response.accepted.length} accepted ${response.rejected.length} rejected ${localOrders.length} total`,
                        );
                        d('mesh')(
                            _(response.rejected)
                                .groupBy('status.code')
                                .map((a, b) => ({ [b]: a.length }))
                                .value(),
                        );
                    }
                }, flags.pushDelay);
            }
        } else {
            d('mesh')(`MESH push: ${orders.length} orders`);
            const response = await attempt(() =>
                this._meshClient.addOrdersAsync(orders),
            );
            d('mesh')(
                `MESH response: ${response.accepted.length} ${response.rejected.length} rejected`,
            );
        }
    }

    private async _connectAndSubscribeAsync(
        client: HttpClient,
        wsEndpoint: string,
        assetPairs: AssetPairsItem[],
    ): Promise<void> {
        const ordersChannelHandler: OrdersChannelHandler = {
            onUpdate: async (_channel, _opts, apiOrders) => {
                const orders = apiOrders.map(o => o.order);
                this._ordersReceived(orders);
            },
            onError: (_channel, err) => {
                d('ws')(`WS err: ${err}`);
            },
            onClose: async () => {
                d('ws')('Channel closed');
                await delay(30000);
                await this._connectAndSubscribeAsync(
                    client,
                    wsEndpoint,
                    assetPairs,
                );
            },
        };
        const ordersChannel = await ordersChannelFactory.createWebSocketOrdersChannelAsync(
            wsEndpoint,
            ordersChannelHandler,
        );
        let count = 0;
        // 5 concurrent requests
        const chunks = _.chunk(assetPairs, 5);
        for (const chunk of chunks) {
            _.forEach(chunk, async pair => {
                const orderBook = await attempt(
                    async () =>
                        client.getOrderbookAsync({
                            baseAssetData: pair.assetDataA.assetData,
                            quoteAssetData: pair.assetDataB.assetData,
                        }),
                    {
                        interval: this._pullDelay,
                        maxRetries: DEFAULT_PULL_RETRIES,
                    },
                );
                count++;
                const orders = _.merge(
                    orderBook.asks.records,
                    orderBook.bids.records,
                ).map(o => o.order);
                if (orders.length > MIN_ORDERBOOK_SIZE) {
                    d('sra')(
                        `Orderbook added (${count}/${assetPairs.length}): base ${pair.assetDataA.assetData} quote ${pair.assetDataB.assetData} ${orders.length}`,
                    );
                    this._ordersReceived(orders);
                    ordersChannel.subscribe({
                        makerAssetData: pair.assetDataA.assetData,
                        takerAssetData: pair.assetDataB.assetData,
                    });
                    ordersChannel.subscribe({
                        makerAssetData: pair.assetDataB.assetData,
                        takerAssetData: pair.assetDataA.assetData,
                    });
                } else {
                    d('sra')(
                        `Orderbook too small base ${pair.assetDataA.assetData} quote ${pair.assetDataB.assetData} ${orders.length}`,
                    );
                }
            });
            await delay(this._pullDelay);
        }
    }
    private async _connectAsync(
        httpEndpoint: string,
        wsEndpoint: string,
        assetDataA?: string,
        assetDataB?: string,
    ): Promise<void> {
        const client = new HttpClient(httpEndpoint as any);
        const allAssetPairs = await attempt(() =>
            client.getAssetPairsAsync({ perPage: 500 }),
        );
        d('sra')(`Orderbook count: ${allAssetPairs.records.length}`);
        const filteredAssetPairs = allAssetPairs.records.filter(pair => {
            if (assetDataA && assetDataB) {
                return (
                    _.includes(
                        [pair.assetDataA.assetData, pair.assetDataB.assetData],
                        assetDataA,
                    ) &&
                    _.includes(
                        [pair.assetDataA.assetData, pair.assetDataB.assetData],
                        assetDataB,
                    )
                );
            } else if (assetDataA) {
                return _.includes(
                    [pair.assetDataA.assetData, pair.assetDataB.assetData],
                    assetDataA,
                );
            }
            return true;
        });
        // MAX 200 websocket connections
        const chunks = _.chunk(filteredAssetPairs, 100);
        for (const chunk of chunks) {
            await this._connectAndSubscribeAsync(client, wsEndpoint, chunk);
        }
    }
}
