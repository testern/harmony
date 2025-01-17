import { before } from 'mocha';
import { stub } from 'sinon';
import { use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import env from '../../app/util/env';

env.nodeEnv = 'test';

process.env.AWS_DEFAULT_REGION = 'us-west-2';

use(chaiAsPromised);

before(() => {
  stub(env, 'maxGranuleLimit').get(() => 350);
  stub(env, 'harmonyClientId').get(() => 'harmony-test');
  stub(env, 'syncRequestPollIntervalMs').get(() => 0);
  stub(env, 'sharedSecretKey').get(() => Buffer.from('_THIS_IS_MY_32_CHARS_SECRET_KEY_', 'utf8'));
});
