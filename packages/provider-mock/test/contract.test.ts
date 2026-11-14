import { describePaymentProviderContract } from "@previewpay/testing";
import { MockPaymentProvider } from "@previewpay/provider-mock";

describePaymentProviderContract({
  create: () => new MockPaymentProvider({ secret: "contract_secret" }),
  simulate: (provider) => {
    const mock = provider as MockPaymentProvider;
    return {
      setStatus: (paymentId, status) => mock.setStatus(paymentId, status),
      webhook: (paymentId, options = {}) => {
        const { rawBody, headers } = mock.buildWebhook(paymentId, options);
        return { rawBody, headers };
      },
    };
  },
});
