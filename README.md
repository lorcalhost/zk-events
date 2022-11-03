<img src="https://i.imgur.com/Y9xd6Mq.png" width="250">

# ZK Events

A Mina zkApp that allows users to create events, create a whitelist of people who can claim the tickets and lets people prove ticket ownership at the venue.

## General architecture description

Each event has its own smart contract which stores a merkle root for the whitelist. The merkle tre is pre-setup with leaves for the whitelisted users. The merkle tree is updated whenever user claims a ticket. The smart contract also stores a merkle root for the current owners of the tickets.
The zkApp also generates a ticket QR code containing merkle tree data that can be used to prove ownership at the venue.

## Progress

- [x] Figure out general architecture
- [x] Event generation with whitelist
- [x] Ticket claiming if in whitelist
- [ ] Gameify console interaction
- [ ] Limits on total number of tickets and claimable per user
- [ ] Prove ticket ownership
- [ ] Allow users to trade tickets before the event
- [x] QR code generation
- [ ] QR code generation with merkle tree data
- [ ] Scanner Program
- [ ] Frontend

## How to build

```sh
npm run zkevents
```

## Useful Links

- Snarky sparse merkle tree: https://github.com/Comdex/snarky-smt
- Snarkyjs documentation: https://o1-labs.github.io/snarkyjs/index.html

## Notes

The zkApp is still actively under development.  
This project is being built as part of Mina's zkApp Builders Program.
