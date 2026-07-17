#include "utils/lpac/utils.h"

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>

static int expect_value(const char *value, bool fallback, bool expected) {
  if (value)
    setenv("LPAC_TEST_BOOL", value, 1);
  else
    unsetenv("LPAC_TEST_BOOL");

  if (getenv_bool_or_default("LPAC_TEST_BOOL", fallback) == expected)
    return 0;

  fprintf(stderr, "unexpected boolean result for value %s\n",
          value ? value : "<unset>");
  return 1;
}

int main(void) {
  return expect_value("1", false, true) || expect_value("0", true, false) ||
         expect_value("y", false, true) || expect_value("ON", false, true) ||
         expect_value("Yes", false, true) || expect_value("n", true, false) ||
         expect_value("OFF", true, false) || expect_value("No", true, false) ||
         expect_value("true", false, true) ||
         expect_value("false", true, false) || expect_value("", true, true) ||
         expect_value("invalid", true, true) ||
         expect_value("invalid", false, false) ||
         expect_value(NULL, false, false);
}
