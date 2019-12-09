import ErrorActions from './errors'
import Network from '../web3/Network'
import * as ActionTypes from '../actions/types'

const JurorsActions = {
  findAll() {
    return async function(dispatch) {
      try {
        const result = await Network.query(`{
          jurors {
            id
            activeBalance
            lockedBalance
            availableBalance
            deactivationBalance
            createdAt
          }
        }`)
        dispatch(JurorsActions.receiveAll(result.jurors))
      } catch(error) {
        dispatch(ErrorActions.show(error))
      }
    }
  },

  findDrafts(id) {
    return async function(dispatch) {
      try {
        const result = await Network.query(`{
          juror (id: "${id}") {
            id
            drafts {
              id
              weight
              rewarded
              commitment
              outcome
              leaker
              createdAt
              round {
                id
                number
                dispute {
                  id
                }
              }
            }
          }
        }`)
        dispatch(JurorsActions.receiveJurorDrafts(result.juror.drafts))
      } catch(error) {
        dispatch(ErrorActions.show(error))
      }
    }
  },

  findAccounting(id) {
    return async function(dispatch) {
      try {
        const result = await Network.query(`{
          juror (id: "${id}") {
            id
            movements {
              id
              type
              amount
              effectiveTermId
              createdAt
            }
          }
        }`)
        dispatch(JurorsActions.receiveJurorAccounting(result.juror.movements))
      } catch(error) {
        dispatch(ErrorActions.show(error))
      }
    }
  },

  receiveAll(list) {
    return { type: ActionTypes.RECEIVE_JURORS_LIST, list }
  },

  receiveJurorDrafts(jurorDrafts) {
    return { type: ActionTypes.RECEIVE_JUROR_DRAFTS, jurorDrafts }
  },

  receiveJurorAccounting(jurorAccounting) {
    return { type: ActionTypes.RECEIVE_JUROR_ACCOUNTING, jurorAccounting }
  },
}

export default JurorsActions
