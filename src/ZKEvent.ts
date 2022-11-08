import {
  SmartContract,
  isReady,
  shutdown,
  Poseidon,
  Field,
  Experimental,
  Permissions,
  DeployArgs,
  State,
  state,
  CircuitValue,
  PublicKey,
  UInt32,
  UInt64,
  Bool,
  prop,
  Mina,
  method,
  PrivateKey,
  AccountUpdate,
} from 'snarkyjs';

import {
  MerkleTree,
  BaseMerkleWitness,
} from 'snarkyjs/dist/node/lib/merkle_tree.js';

import { initialBalance } from './ZKEvent.test';

export const whitelistSize = 256;

export class MerkleWitness extends Experimental.MerkleWitness(whitelistSize) {}

export class Account extends CircuitValue {
  @prop publicKey: PublicKey;
  @prop tickets: UInt32;

  constructor(publicKey: PublicKey, tickets: UInt32) {
    super(publicKey, tickets);
    this.publicKey = publicKey;
    this.tickets = tickets;
  }

  hash(): Field {
    return Poseidon.hash(this.toFields());
  }

  addTicket(n: number): Account {
    return new Account(this.publicKey, this.tickets.add(n));
  }

  removeTicket(n: number): Account {
    this.tickets.assertGte(UInt32.fromNumber(n));
    return new Account(this.publicKey, this.tickets.sub(n));
  }
}

export class ZKEvent extends SmartContract {
  @state(Field) commitment = State<Field>();
  @state(UInt32) ticketsClaimed = State<UInt32>();
  @state(UInt32) maxTickets = State<UInt32>();
  @state(UInt32) maxTicketsPerAccount = State<UInt32>();
  @state(UInt32) isReady = State<UInt32>();

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
    this.balance.addInPlace(UInt64.fromNumber(initialBalance));
    this.commitment.set(Field.zero);
    this.ticketsClaimed.set(UInt32.fromNumber(0));
    this.maxTickets.set(UInt32.fromNumber(0));
    this.isReady.set(UInt32.fromNumber(0));
  }

  @method
  setup(
    initialCommitment: Field,
    maxTickets: UInt32,
    maxTicketsPerAccount: UInt32
  ) {
    // check if event has already been setup
    let state = this.isReady.get();
    this.isReady.assertEquals(state);
    state.assertEquals(UInt32.fromNumber(0));

    // setup
    this.commitment.set(initialCommitment);
    this.maxTickets.set(maxTickets);
    this.maxTicketsPerAccount.set(maxTicketsPerAccount);

    // update state
    this.isReady.set(UInt32.fromNumber(1));
  }

  @method
  claimTicket(account: Account, path: MerkleWitness) {
    // CHECKS
    let commitment = this.commitment.get();
    this.commitment.assertEquals(commitment);

    let ticketsClaimed = this.ticketsClaimed.get();
    this.ticketsClaimed.assertEquals(ticketsClaimed);

    let maxTickets = this.maxTickets.get();
    this.maxTickets.assertEquals(maxTickets);

    let maxTicketsPerAccount = this.maxTicketsPerAccount.get();
    this.maxTicketsPerAccount.assertEquals(maxTicketsPerAccount);

    // check that account is within the committed Merkle Tree (whitelist)
    path.calculateRoot(account.hash()).assertEquals(commitment);

    // check if more tickets are available
    ticketsClaimed.assertLt(maxTickets);

    // check if user already has max number of tickets
    account.tickets.assertLt(maxTicketsPerAccount);

    // UPDATE STATE
    // add 1 ticket to account
    let newAccount = account.addTicket(1);

    // calculate new merkle root
    let newCommitment = path.calculateRoot(newAccount.hash());
    this.commitment.set(newCommitment);

    // update number of claimed tickets
    this.ticketsClaimed.set(ticketsClaimed.add(UInt32.fromNumber(1)));
  }

  @method
  sendTicket(
    from: Account,
    fromPath: MerkleWitness,
    to: Account,
    toPath: MerkleWitness
  ) {
    // CHECKS
    let commitment = this.commitment.get();
    this.commitment.assertEquals(commitment);

    let ticketsClaimed = this.ticketsClaimed.get();
    this.ticketsClaimed.assertEquals(ticketsClaimed);

    let maxTicketsPerAccount = this.maxTicketsPerAccount.get();
    this.maxTicketsPerAccount.assertEquals(maxTicketsPerAccount);

    // ensure both accounts are within whitelist
    fromPath.calculateRoot(from.hash()).assertEquals(commitment);
    toPath.calculateRoot(to.hash()).assertEquals(commitment);

    // assert from has at least one ticket and to has less than max allowed tickets
    from.tickets.assertGte(UInt32.fromNumber(1));
    to.tickets.assertLt(maxTicketsPerAccount);

    // UPDATE STATE
    // add 1 ticket to account
    let newFromAccount = from.removeTicket(1);
    let newToAccount = to.addTicket(1);

    // calculate new merkle root
    //!TODO fix update merkle root
    // let newCommitment = fromPath.calculateRoot(newFromAccount.hash());
    // new MerkleWitness(newCommitment).calculateRoot(newToAccount.hash());
    // newCommitment = newCommitment.calculateRoot(newFromAccount.hash());
    // this.commitment.set(newCommitment);
  }
}
