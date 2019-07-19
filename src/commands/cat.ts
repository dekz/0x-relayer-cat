import { HttpClient, ordersChannelFactory, OrdersChannelHandler, SignedOrder } from '@0x/connect';
import { Command, flags } from '@oclif/command';
import * as _ from 'lodash';
import * as Web3Providers from 'web3-providers';

const DEFAULT_DELAY = 5000;
const delay = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

const attempt = async <T>(
    fn: () => Promise<T>,
    opts: { interval: number; maxRetries: number } = { interval: DEFAULT_DELAY, maxRetries: 10 },
) => {
    let result: T | undefined;
    let currentAttempt = 0;
    let error;
    while (!result && currentAttempt <= opts.maxRetries) {
        currentAttempt++;
        try {
            result = await fn();
        } catch (err) {
            console.log(new Date(), attempt, err.message);
            error = err;
            await delay(opts.interval);
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
            default: 'https://api.radarrelay.com/0x/v2',
            required: true,
        }),
        wsEndpoint: flags.string({
            char: 'w',
            description: 'SRA WebSocket endpoint of the Relayer',
            default: 'wss://ws.radarrelay.com/0x/v2',
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
            description: 'Delay in milliseconds before pushing to mesh (allows for batching)',
        }),
    };

    public static args = [];
    private _sraClient!: HttpClient;
    private _meshClient!: Web3Providers.WebsocketProvider;
    private _pendingMeshOrders: SignedOrder[] = [];
    private _meshPushIntervalId?: NodeJS.Timeout;
    // tslint:disable-next-line:async-suffix
    public async run(): Promise<void> {
        // tslint:disable-next-line:no-shadowed-variable
        const { args, flags } = this.parse(Cat);
        const { httpEndpoint, wsEndpoint, assetDataA, assetDataB } = flags;
        if (flags.toSRA) {
            this._sraClient = new HttpClient(flags.toSRA);
        }
        if (flags.toMesh) {
            const clientConfig = { fragmentOutgoingMessages: false };
            this._meshClient = new Web3Providers.WebsocketProvider(flags.toMesh, {
                clientConfig: clientConfig as any, // HACK: Types are saying this is a string
            });
            // const heartbeatSubscriptionId = await this._meshClient.subscribe('mesh_subscribe', 'heartbeat', []);
            // this._meshClient.on(heartbeatSubscriptionId, console.log);
        }
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
                void this._sraClient.submitOrderAsync(order);
            }
        } else if (flags.toMesh) {
            this._pushOrdersToMeshAsync(filteredOrders);
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
                this._meshPushIntervalId = setInterval(() => {
                    const stringifiedSignedOrders = this._pendingMeshOrders.map(stringifyOrder);
                    this._pendingMeshOrders = [];
                    void this._meshClient.send('mesh_addOrders', [stringifiedSignedOrders]);
                }, flags.pushDelay);
            }
        } else {
            const stringifiedSignedOrders = orders.map(stringifyOrder);
            void this._meshClient.send('mesh_addOrders', [stringifiedSignedOrders]);
        }
    }

    private async _connectAsync(
        httpEndpoint: string,
        wsEndpoint: string,
        assetDataA?: string,
        assetDataB?: string,
    ): Promise<void> {
        const client = new HttpClient(httpEndpoint as any);
        const allAssetPairs = await client.getAssetPairsAsync({ perPage: 500 });
        const filteredAssetPairs = allAssetPairs.records.filter(pair => {
            if (assetDataA && assetDataB) {
                return (
                    _.includes([pair.assetDataA.assetData, pair.assetDataB.assetData], assetDataA) &&
                    _.includes([pair.assetDataA.assetData, pair.assetDataB.assetData], assetDataB)
                );
            } else if (assetDataA) {
                return _.includes([pair.assetDataA.assetData, pair.assetDataB.assetData], assetDataA);
            }
            return true;
        });
        const ordersChannelHandler: OrdersChannelHandler = {
            onUpdate: async (_channel, _opts, apiOrders) => {
                const orders = apiOrders.map(o => o.order);
                this._ordersReceived(orders);
            },
            // tslint:disable-next-line:no-empty
            onError: () => {},
            onClose: () => {
                console.error('Channel closed');
                process.exit(1);
            },
        };
        const ordersChannel = await ordersChannelFactory.createWebSocketOrdersChannelAsync(
            wsEndpoint as any,
            ordersChannelHandler,
        );
        for (const pair of filteredAssetPairs) {
            const orderBook = await attempt(async () =>
                client.getOrderbookAsync({
                    baseAssetData: pair.assetDataA.assetData,
                    quoteAssetData: pair.assetDataB.assetData,
                }),
            );
            const orders = _.merge(orderBook.asks.records, orderBook.bids.records).map(o => o.order);
            this._ordersReceived(orders);
            ordersChannel.subscribe({
                baseAssetData: pair.assetDataA.assetData,
                quoteAssetData: pair.assetDataB.assetData,
                limit: 1000,
            });
            await delay(DEFAULT_DELAY);
        }
    }
}
const stringifyOrder = (signedOrder: SignedOrder): any => {
    const stringifiedSignedOrder = {
        signature: signedOrder.signature,
        senderAddress: signedOrder.senderAddress,
        makerAddress: signedOrder.makerAddress,
        takerAddress: signedOrder.takerAddress,
        makerFee: signedOrder.makerFee.toString(),
        takerFee: signedOrder.takerFee.toString(),
        makerAssetAmount: signedOrder.makerAssetAmount.toString(),
        takerAssetAmount: signedOrder.takerAssetAmount.toString(),
        makerAssetData: signedOrder.makerAssetData,
        takerAssetData: signedOrder.takerAssetData,
        salt: signedOrder.salt.toString(),
        exchangeAddress: signedOrder.exchangeAddress,
        feeRecipientAddress: signedOrder.feeRecipientAddress,
        expirationTimeSeconds: signedOrder.expirationTimeSeconds.toString(),
    };
    return stringifiedSignedOrder;
};
