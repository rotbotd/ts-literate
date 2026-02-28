/// # Type Guard Test
///
/// Testing that type guard predicates link the lhs to the parameter.

interface Cat {
  meow(): void;
}

interface Dog {
  bark(): void;
}

type Animal = Cat | Dog;

/// A type guard function - the `animal` in `animal is Cat` should link
/// to the parameter `animal`.

function isCat(animal: Animal): animal is Cat {
  return "meow" in animal;
}

/// Using the type guard:

function speak(animal: Animal) {
  if (isCat(animal)) {
    animal.meow();
  }
}
