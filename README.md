# pandora-css-variables

generate css variables file from file `globalVarFile` and leaves the variables of file `varFile`.

## Install
```
$ npm install -D pandora-css-variables
```

## Example:

```
const generateCssVariables = require('pandora-css-variables');

const options = {
  varFile: path.join(__dirname, './src/styles/variables.less'), // include all color variables in `varFile` that you want to change dynamically
  globalVarFile: path.join(__dirname, './src/styles/global-variables.less'), // the less variables in the file will generate css variables. For example, if @primary-1 is defined in the file, --primary-1 will be added to the output.
  outputFilePath: path.join(__dirname, './public/color.less'), // if provided, file will be created with generated less/styles
  options: {}, // (Optional) less options
  themeReplacement: {} // (Optional) the variables that need to replace the variables in `varFile`
}

generateCssVariables(options);
```