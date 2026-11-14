import { describeStorageContract } from "@previewpay/testing";
import { MemoryStorage } from "@previewpay/storage-memory";

describeStorageContract({
  create: () => new MemoryStorage(),
});
