/**
 * Pet accessories add-on modules registered (api.registerPetAccessory). Read only by lazy chunks (the
 * API and the pet layer).
 */

/** Accessory id -> { id, moduleId, slot, model, scale, offset, kinds, when }, in registration order. */
export const PET_ACCESSORIES = new Map();

export const PET_ACCESSORY_SLOTS = ['head'];
export const ACCESSORIES_HOOK = 'dicer.petAccessoriesChanged';
