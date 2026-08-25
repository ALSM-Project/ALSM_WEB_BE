import { ConfirmMfaSetupResult } from '../application/confirm-mfa-setup.service';
import { StartMfaSetupResult } from '../application/start-mfa-setup.service';

export class MfaPresenter {
  static setup(result: StartMfaSetupResult): StartMfaSetupResult {
    return result;
  }

  static confirmation(result: ConfirmMfaSetupResult): ConfirmMfaSetupResult {
    return result;
  }
}
