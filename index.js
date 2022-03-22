
const cron = require('node-cron')
const { TezosToolkit } = require('@taquito/taquito')
const { InMemorySigner } = require('@taquito/signer')

const config = require('./config.json')
const database = require('./database/')

const voteTask = cron.schedule(`*/${config.rewardInterval} * * * *`, async () => {
  await database.connected

  const signer = new InMemorySigner(config.tezos.admin)
  const tezos = new TezosToolkit(config.tezos.rpc)
  tezos.setSignerProvider(signer)
  const contract = await tezos.contract.at(config.tezos.tokenAddress)

  const pendingRewards = await database.query('SELECT * FROM `rewards_vote` WHERE `status`=?', [0])
  const records = []
  for (let i = 0; i < pendingRewards.length; i++) {
    const reward = pendingRewards[i]
    records.push({
      voter: reward.address,
      asset_id: reward.asset_id
    })
  }

  let rewarded = false
  try {
    console.log(`Rewarding ${records.length} people...`)
    const op = await contract.methods.record_votes(records).send()
    console.log('Confirming rewards...')
    await op.confirmation(1)
    console.log('Successful!')
    rewarded = true
  } catch (error) {
    console.error(error)
  }

  if (rewarded) {
    console.log('Updating database...')
    const where = pendingRewards.map((reward) => '`id`=' + reward.id).join(' OR ')
    await database.query('UPDATE `rewards_vote` SET `status`=1 WHERE ' + where)
    console.log('Finished\r\n')
  }
})

process.on('SIGINT', () => {
  voteTask.stop()
  database.close()
})

process.on('uncaughtException', error => {
  console.error(error.message)
})

process.on('unhandledRejection', error => {
  console.error(error)
})
