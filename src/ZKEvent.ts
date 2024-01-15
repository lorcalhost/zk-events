import {
  SmartContract,
  Poseidon,
  Field,
  Permissions,
  DeployArgs,
  State,
  state,
  CircuitValue,
  PublicKey,
  PrivateKey,
  UInt32,
  UInt64,
  prop,
  method,
  MerkleWitness,
} from 'snarkyjs';

export const initialBalance = 10_000_000_000;

export const whitelistSize = 256;

export class MyMerkleWitness extends MerkleWitness(whitelistSize) {}

export class Account extends CircuitValue {
  @prop publicKey: PublicKey;
  @prop tickets: UInt32;
  @prop transferred: UInt32;

  constructor(
    publicKey: PublicKey,
    tickets: UInt32,
    transferred: UInt32 = UInt32.from(0)
  ) {
    super(publicKey, tickets, transferred);
    this.publicKey = publicKey;
    this.tickets = tickets;
    this.transferred = transferred;
  }

  hash(): Field {
    return Poseidon.hash(this.toFields());
  }

  addTicket(n: number): Account {
    return new Account(this.publicKey, this.tickets.add(n));
  }

  addTransferred(n: number): Account {
    return new Account(this.publicKey, this.tickets, this.transferred.add(n));
  }

  removeTicket(n: number): Account {
    this.tickets.assertGte(UInt32.from(n));
    return new Account(this.publicKey, this.tickets.sub(n));
  }
}

export class ZKEvent extends SmartContract {
  @state(Field) commitment = State<Field>();
  @state(UInt32) ticketsClaimed = State<UInt32>();
  @state(UInt32) maxTickets = State<UInt32>();
  @state(UInt32) maxTicketsPerAccount = State<UInt32>();
  @state(PublicKey) owner = State<PublicKey>();
  @state(UInt64) startTime = State<UInt64>();

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
    this.balance.addInPlace(UInt64.from(initialBalance));
    this.commitment.set(Field(0));
    this.ticketsClaimed.set(UInt32.from(0));
    this.maxTickets.set(UInt32.from(0));
    this.owner.set(PublicKey.empty());
    this.startTime.set(UInt64.from(0));
  }

  @method
  setup(
    initialCommitment: Field,
    maxTickets: UInt32,
    maxTicketsPerAccount: UInt32,
    startTime: UInt64,
    ownerPKey: PrivateKey
  ) {
    // check if event has already been setup
    let owner = this.owner.get();
    this.owner.assertEquals(owner);
    owner.assertEquals(PublicKey.empty());

    // check that event has not started
    let timeNow = this.network.timestamp.get();
    this.network.timestamp.assertEquals(timeNow);
    timeNow.assertLt(startTime);

    // setup
    this.commitment.set(initialCommitment);
    this.maxTickets.set(maxTickets);
    this.maxTicketsPerAccount.set(maxTicketsPerAccount);
    this.startTime.set(startTime);

    // update state
    this.owner.set(ownerPKey.toPublicKey());
  }

  @method
  claimTicket(account: Account, path: MyMerkleWitness, privateKey: PrivateKey) {
    // CHECKS
    let commitment = this.commitment.get();
    this.commitment.assertEquals(commitment);

    let ticketsClaimed = this.ticketsClaimed.get();
    this.ticketsClaimed.assertEquals(ticketsClaimed);

    let maxTickets = this.maxTickets.get();
    this.maxTickets.assertEquals(maxTickets);

    let maxTicketsPerAccount = this.maxTicketsPerAccount.get();
    this.maxTicketsPerAccount.assertEquals(maxTicketsPerAccount);

    let startTime = this.startTime.get();
    this.startTime.assertEquals(startTime);

    let timeNow = this.network.timestamp.get();
    this.network.timestamp.assertEquals(timeNow);

    // check that event has not started
    timeNow.assertLt(startTime);

    // check that msg.sender is the owner of the account
    privateKey.toPublicKey().assertEquals(account.publicKey);

    // check that account is within the committed Merkle Tree (whitelist)
    path.calculateRoot(account.hash()).assertEquals(commitment);

    // check if more tickets are available
    ticketsClaimed.assertLt(maxTickets);

    // check if user already has max number of tickets
    account.tickets.add(account.transferred).assertLt(maxTicketsPerAccount);

    // UPDATE STATE
    // add 1 ticket to account
    let newAccount = account.addTicket(1);

    // calculate new merkle root
    let newCommitment = path.calculateRoot(newAccount.hash());
    this.commitment.set(newCommitment);

    // update number of claimed tickets
    this.ticketsClaimed.set(ticketsClaimed.add(UInt32.from(1)));
  }

  @method
  sendTicket(
    from: Account,
    fromPath: MyMerkleWitness,
    to: Account,
    toPath: MyMerkleWitness,
    privateKey: PrivateKey
  ) {
    // CHECKS
    let commitment = this.commitment.get();
    this.commitment.assertEquals(commitment);

    let maxTicketsPerAccount = this.maxTicketsPerAccount.get();
    this.maxTicketsPerAccount.assertEquals(maxTicketsPerAccount);

    let startTime = this.startTime.get();
    this.startTime.assertEquals(startTime);

    let timeNow = this.network.timestamp.get();
    this.network.timestamp.assertEquals(timeNow);

    // check that event has not started
    timeNow.assertLt(startTime);

    // check that msg.sender is the owner of the account
    privateKey.toPublicKey().assertEquals(from.publicKey);

    // ensure first witness is correct
    fromPath.calculateRoot(from.hash()).assertEquals(commitment);

    // assert from has at least one ticket and to has less than max allowed tickets
    from.tickets.assertGte(UInt32.from(1));
    to.tickets.assertLt(maxTicketsPerAccount);

    // UPDATE STATE
    // remove 1 ticket from account
    let newFromAccount = from.removeTicket(1);
    newFromAccount = newFromAccount.addTransferred(1);

    // ensure pre computation of second witness is correct
    let tempCommitment = fromPath.calculateRoot(newFromAccount.hash());
    toPath.calculateRoot(to.hash()).assertEquals(tempCommitment);

    // add 1 ticket to account
    let newToAccount = to.addTicket(1);

    // calculate new merkle root
    let newCommitment = toPath.calculateRoot(newToAccount.hash());
    this.commitment.set(newCommitment);
  }
}
