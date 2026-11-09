# App

React 19, Vite, Tailwind 4 and viem. The app has no backend of its own for trading: every number is read from Elysium and every action is a transaction signed in the user's wallet (MetaMask, Rabby or any injected wallet).

```bash
cp .env.example .env
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check and production build into dist/
```

`VITE_API_URL` points to the keeper (used for IPFS metadata). All other `VITE_*` values are public contract addresses.
