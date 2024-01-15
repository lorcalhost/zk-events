<img src="https://i.imgur.com/Y9xd6Mq.png" width="250">

# ZK Events

A Mina zkApp for creating whitelisted events and have users claim tickets. Users can also send tickets to other users and prove ticket ownership at the event.

## General architecture description

Each event has its own smart contract which stores a merkle root for the whitelist merkle tree. The merkle tree keeps track of any change in ticket balance for the users. The merkle root is updated whenever user claims or transfers a ticket. The smart contract also keeps track of the event details (max total tickets, max tickets per user, whitelist size, tickets claimed, owner).
The zkApp also generates a ticket QR code containing data that can be used to prove ticket ownership at the venue.

## Progress

### V1

- [x] General architecture
- [x] Event generation with whitelist
- [x] Ticket claiming if in whitelist
- [x] Gameify console interaction
- [x] Limits on total number of tickets
- [x] Limits on maximum number of tickets claimable per user
- [x] Prove ticket ownership
- [x] Ticket transfer between users
- [x] QR code generation
- [x] Write tests
- [x] Separate into multiple files tests, contract and demo
- [x] Add msg.sender check on claim and transfer
- [x] More concise tests
- [x] Whitelist modifiable by owner
- [x] Add timestamp check on claim and transfer

### V2

- [ ] Hide more data
- [ ] QR code with less identifiable data
- [ ] Create verifier program to run at the event
- [ ] Frontend

## How to run

Run demo:

```sh
npm run demo
```

Run tests:

```sh
npm run test
```

## Useful Links

- Snarkyjs documentation: https://o1-labs.github.io/snarkyjs/index.html

## Notes

The zkApp is still actively under development.  
This project is being built as part of Mina's zkApp Builders Program.
