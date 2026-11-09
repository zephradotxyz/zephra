/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LAUNCHPAD?: string;
  readonly VITE_CONFIG?: string;
  readonly VITE_POOL_FACTORY?: string;
  readonly VITE_MARKET_FACTORY?: string;
  readonly VITE_RPC?: string;
  readonly VITE_KEEPER_API?: string;
  readonly VITE_MEMORY?: string;
}
