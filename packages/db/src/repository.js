/**
 * Interface expected from a future persistence adapter.
 *
 * A concrete implementation can use Prisma, Drizzle, node-postgres, or an HTTP API.
 * Phase 1 keeps this as a contract so the semantic engine does not depend on a database client.
 */
export class FitnessRepository {
  async getUserContext(_userId) {
    throw new Error("FitnessRepository.getUserContext must be implemented.");
  }

  async saveUserContext(_context) {
    throw new Error("FitnessRepository.saveUserContext must be implemented.");
  }

  async getSemanticFitnessState(_userId, _date) {
    throw new Error("FitnessRepository.getSemanticFitnessState must be implemented.");
  }

  async saveSemanticFitnessState(_state) {
    throw new Error("FitnessRepository.saveSemanticFitnessState must be implemented.");
  }
}
