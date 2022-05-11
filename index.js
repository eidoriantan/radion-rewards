
const fs = require('fs')
const path = require('path')
const cron = require('node-cron')
const { TezosToolkit } = require('@taquito/taquito')
const { InMemorySigner } = require('@taquito/signer')

const config = require('./config.json')
const database = require('./database/')

const signer = new InMemorySigner(config.tezos.admin)
const tezos = new TezosToolkit(config.tezos.rpc)
tezos.setSignerProvider(signer)

const appDataDir = path.resolve(__dirname, 'data')
fs.mkdir(appDataDir, (error) => {
  if (error && error.code !== 'EEXIST') {
    console.error(error)
    process.exit(1)
  }
})

const billboardPath = path.resolve(appDataDir, 'billboard-latest.txt')
let billboardLatest = new Promise((resolve, reject) => {
  fs.readFile(billboardPath, { encoding: 'utf-8' }, (err, data) => {
    if (!err) resolve(data)
    else resolve(null)
  })
})

const rewardInterval = config.rewardInterval.minute + ' ' +
  config.rewardInterval.hour + ' ' +
  config.rewardInterval.dayOfMonth + ' ' +
  config.rewardInterval.month + ' ' +
  config.rewardInterval.dayOfWeek

const task = cron.schedule(rewardInterval, async () => {
  await database.connected

  const pendingRewardsVotes = await database.query('SELECT * FROM `rewards_vote` WHERE `status`=?', [0])
  const pendingRewardsMembers = await database.query('SELECT * FROM `rewards_member` WHERE `status`=?', [0])
  const total = pendingRewardsVotes.length + pendingRewardsMembers.length
  const recordsVotes = []
  const recordsMembers = []
  if (total === 0) return

  for (let i = 0; i < pendingRewardsVotes.length; i++) {
    const reward = pendingRewardsVotes[i]
    recordsVotes.push({
      voter: reward.address,
      asset_id: reward.asset_id
    })
  }

  for (let i = 0; i < pendingRewardsMembers.length; i++) {
    const reward = pendingRewardsMembers[i]
    recordsMembers.push({
      address: reward.address,
      username: reward.username
    })
  }

  const contract = await tezos.contract.at(config.tezos.tokenAddress)
  const storage = await contract.storage()
  let rewarded = false

  try {
    console.log(`Rewarding ${total} people...`)
    const batch = tezos.contract.batch()
    if (recordsVotes.length > 0) batch.withContractCall(contract.methods.record_votes(recordsVotes))
    if (recordsMembers.length > 0) batch.withContractCall(contract.methods.record_members(recordsMembers))

    const op = await batch.send()
    console.log('Confirming rewards...')
    await op.confirmation(1)
    console.log('Successful!')
    rewarded = true

    const voteCost = storage.vote_reward.c[0] * recordsVotes.length
    const memberCost = storage.member_reward.c[0] * recordsMembers.length
    const rewardCostMutez = voteCost + memberCost
    const rewardCost = rewardCostMutez / 1000000
    const feesMutez = op.results.map(result => parseInt(result.fee)).reduce((sum, a) => sum + a, 0)
    const fees = feesMutez / 1000000

    console.log('Rewarded Votes: ' + recordsVotes.length)
    console.log('Rewarded Wallets: ' + recordsMembers.length)
    console.log('Reward Cost (RADIO Tokens): ' + rewardCost)
    console.log('Fees (XTZ): ' + fees)
  } catch (error) {
    console.error(error)
  }

  if (rewarded) {
    console.log('Updating database...')
    if (pendingRewardsVotes.length > 0) {
      const whereVotes = pendingRewardsVotes.map((reward) => '`id`=' + reward.id).join(' OR ')
      await database.query('UPDATE `rewards_vote` SET `status`=1 WHERE ' + whereVotes)
    }

    if (pendingRewardsMembers.length > 0) {
      const whereMembers = pendingRewardsMembers.map((reward) => '`id`=' + reward.id).join(' OR ')
      await database.query('UPDATE `rewards_member` SET `status`=1 WHERE ' + whereMembers)
    }
    console.log('Finished\r\n')
  }
})

const billboardTask = cron.schedule('5 0 1 * *', async function () {
  await database.connected

  const billboardRes = await database.query('SELECT * FROM `song_billboard_month` ORDER BY `BILLBOARD_ID` DESC LIMIT 1', [])
  const billboard = JSON.parse(billboardRes[0].BILLBOARD)
  if (billboard.length === 0) {
    console.error('Monthly billboard is empty. Skipping billboard reward')
    return
  }

  const billboardDate = billboardRes[0].DATE.toISOString()
  const bbLatest = await billboardLatest

  if (bbLatest === null || billboardDate !== bbLatest) {
    billboardLatest = Promise.resolve(billboardDate)
    fs.writeFileSync(billboardPath, billboardDate)
  } else {
    console.error('Billboard was already rewarded!')
    return
  }

  const rewards = []
  for (let i = 0; i < billboard.length; i++) {
    const reward = billboard[i]
    const username = reward.username
    const userRes = await database.query('SELECT * FROM `sitelok` WHERE `Username`=? LIMIT 1', [username])
    const user = userRes[0]
    rewards.push(user.Custom6)
  }

  const contract = await tezos.contract.at(config.tezos.billboardAddress)
  const storage = await contract.storage()

  try {
    console.log('Rewarding billboard...')
    console.log(`Rewarding ${rewards.length} people...`)
    const op = await contract.methods.reward(rewards).send()
    console.log('Confirming rewards...')
    await op.confirmation(1)
    console.log('Successful!')

    const rewardCost = storage.reward.c[0] * rewards.length / 1000000
    const feesMutez = op.results.map(result => parseInt(result.fee)).reduce((sum, a) => sum + a, 0)
    const fees = feesMutez / 1000000

    console.log('Rewarded Wallets: ' + rewards.length)
    console.log('Reward Cost (RADIO Tokens): ' + rewardCost)
    console.log('Fees (XTZ): ' + fees)
  } catch (error) {
    console.error(error)
  }
})

process.on('SIGINT', () => {
  task.stop()
  billboardTask.stop()
  database.close()
})

process.on('uncaughtException', error => {
  console.error(error.message)
})

process.on('unhandledRejection', error => {
  console.error(error)
})
