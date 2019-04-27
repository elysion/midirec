/*module.exports = {
    "env": {
        "es6": true,
        "node": true
    },
    "extends": "eslint:recommended",
    "parserOptions": {
        "sourceType": "module"
    },
    "rules": {
        "indent": [
            "error",
            2
        ],
        "linebreak-style": [
            "error",
            "unix"
        ],
        "quotes": [
            "error",
            "single"
        ],
        "semi": [
            "error",
            "never"
        ]
    }
};*/

module.exports = {
  eslintConfig:
    {
      parserOptions: {
        ecmaVersion: 7
      }
      ,
      rules: {
        semi: ["error", "never"]
      }
    }
  ,
  prettierOptions: {
    bracketSpacing: true
  }
  ,
  fallbackPrettierOptions: {
    singleQuote: false
  }
}
