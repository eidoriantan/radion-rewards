
const mysql = require('mysql')
const config = require('../config.json')

const connection = mysql.createConnection({
  host: config.mysql.hostname,
  user: config.mysql.username,
  password: config.mysql.password,
  database: config.mysql.database
})

const connected = new Promise((resolve, reject) => {
  connection.connect((error) => {
    if (error) {
      console.error('Unable to connect to MySQL server!')
      return reject(error)
    }

    console.log('Connected to MySQL Server!')
    return resolve(true)
  })
})

async function query (statement, values = []) {
  await connected
  return new Promise((resolve, reject) => {
    connection.query(statement, values, (error, results, fields) => {
      if (error) {
        console.error('Error with query', error)
        return reject(error)
      }

      resolve(results)
    })
  })
}

function close () {
  connection.destroy()
}

module.exports = { connected, query, close }
