'use strict'

const sqlite3 = require('sqlite3').verbose()
let db

exports.openOrCreate = async () => {
  return new Promise(resolve => {
    db = new sqlite3.Database('./domains.sqlite3', async () => {
      await initDatabase()
      resolve()
    })
  })
}

const initDatabase = async () => {
  return new Promise(resolve => {
    return db.run(`
      CREATE TABLE IF NOT EXISTS domains (
        Name TEXT,
        State TEXT,
        GrantDate TEXT,
        LastValidityDate TEXT,
        IsDNSSecInUse TEXT,
        Holder TEXT,
        Registrar TEXT,
        OrganizationId TEXT,
        Address TEXT,
        PostalCode TEXT,
        PostalArea TEXT,
        AssociationType TEXT,
        PhoneNumber TEXT,
        DepartmentOrContactPerson TEXT,
        Country TEXT,
        NameServer1 TEXT,
        NameServer2 TEXT,
        NameServer3 TEXT,
        NameServer4 TEXT,
        NameServer5 TEXT,
        NameServer6 TEXT,
        NameServer7 TEXT,
        NameServer8 TEXT,
        NameServer9 TEXT,
        NameServer10 TEXT,
        HttpStatusCode TEXT,
        DependencyJson TEXT
      )
    `, () => {
      resolve()
    })
  })
}

exports.insertDomain = async domainObj => {
  return new Promise(resolve => {
    let statement = db.prepare(`
      INSERT INTO domains VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `)

    statement.run(
      domainObj['Name'],
      domainObj['State'],
      domainObj['GrantDate'],
      domainObj['LastValidityDate'],
      domainObj['IsDNSSecInUse'],
      domainObj['Holder'],
      domainObj['Registrar'],
      domainObj['OrganizationId'],
      domainObj['Address'],
      domainObj['PostalCode'],
      domainObj['PostalArea'],
      domainObj['AssociationType'],
      domainObj['PhoneNumber'],
      domainObj['DepartmentOrContactPerson'],
      domainObj['Country'],
      domainObj['NameServer1'],
      domainObj['NameServer2'],
      domainObj['NameServer3'],
      domainObj['NameServer4'],
      domainObj['NameServer5'],
      domainObj['NameServer6'],
      domainObj['NameServer7'],
      domainObj['NameServer8'],
      domainObj['NameServer9'],
      domainObj['NameServer10'],
      '',
      ''
    )

    statement.finalize(() => {
      resolve()
    })
  })
}

exports.getAllDomains = () => {
  return new Promise(resolve => {
    db.all(`SELECT rowid, Name FROM domains`, (err, domains) => {
      if (err) {
        console.error(err.message)
      }

      resolve(domains)
    })
  })
}

exports.getWorkingDomains = () => {
  return new Promise(resolve => {
    db.all(`SELECT rowid, Name FROM domains WHERE HttpStatusCode=200`, (err, domains) => {
      if (err) {
        console.error(err.message)
      }

      resolve(domains)
    })
  })
}

exports.saveHttpStatusCode = async (httpStatusCode, rowId) => {
  return new Promise(resolve => {
    let statement = db.prepare(`
      UPDATE domains SET HttpStatusCode=? WHERE rowid=?
    `)
    statement.run(httpStatusCode, rowId)
    statement.finalize(() => {
      resolve()
    })
  })
}

exports.saveDependencyJson = async (json, rowId) => {
  return new Promise(resolve => {
    let statement = db.prepare(`
      UPDATE domains SET DependencyJson=? WHERE rowid=?
    `)
    statement.run(json, rowId)
    statement.finalize(() => {
      resolve()
    })
  })
}

exports.getAll = async (fieldsString) => {
  return new Promise(resolve => {
    db.all(`SELECT ${fieldsString} FROM domains`, (err, domains) => {
      if (err) {
        console.error(err.message)
      }

      resolve(domains)
    })
  })
}

exports.close = () => {
  db.close()
}
