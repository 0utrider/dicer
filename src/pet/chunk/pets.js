/** The pet layer (lazy chunk). A stub until the pet art lands: every call is a no-op. */
export function createPetLayer() {
  return {
    begin() {},
    landed() {},
    leave() {},
    end() {},
    update: () => false,
    dispose() {},
  };
}
