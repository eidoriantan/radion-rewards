
const cron = require('node-cron')
const { TezosToolkit } = require('@taquito/taquito')
const { InMemorySigner } = require('@taquito/signer')

const config = require('./config.json')
const database = require('./database/')

const task = cron.schedule(`*/${config.rewardInterval} * * * *`, async () => {
  await database.connected

  const signer = new InMemorySigner(config.tezos.admin)
  const tezos = new TezosToolkit(config.tezos.rpc)
  tezos.setSignerProvider(signer)
  const contract = await tezos.contract.at(config.tezos.tokenAddress)

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

process.on('SIGINT', () => {
  task.stop()
  database.close()
})

process.on('uncaughtException', error => {
  console.error(error.message)
})

process.on('unhandledRejection', error => {
  console.error(error)
})
