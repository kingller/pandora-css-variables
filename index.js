const path = require('path');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const lessToJs = require('less-vars-to-js');
const themeColorSwitch = require('theme-color-switch');
const CleanCSS = require('clean-css');
const { console } = require('inspector');

function getVarNames(content) {
    if (!content) {
        return null;
    }
    const matches = content.match(/@[\w-]+/g);
    return matches;
}

function replaceVarNames(content, { missVarJs, globalVarJs }) {
    if (!content) {
        return content;
    }
    return content.replace(/@[\w-]+/g, function (varName) {
        if (missVarJs[varName]) {
            return replaceVarNames(missVarJs[varName], { missVarJs, globalVarJs });
        }
        if (globalVarJs[varName]) {
            return replaceVarNames(globalVarJs[varName], { missVarJs, globalVarJs });
        }
        return varName;
    });
}

function getImportFiles({ globalVarFile, globalVarContent }) {
    if (!globalVarContent) {
        return null;
    }
    const importMatches = globalVarContent.match(/@import\s+('(.*?)'|url\('(.*?)'\))/g);
    if (!importMatches) {
        return null;
    }
    const importFiles = importMatches.map(function (importStr) {
        const importFilePath = importStr.match(/'(.*?)'/)[1];
        return path.join(path.dirname(globalVarFile), importFilePath);
    });
    return importFiles;
}

async function getImportVars({ globalVarFile, globalVarContent }) {
    const importVars = {};
    const importFiles = getImportFiles({ globalVarFile, globalVarContent });
    for (let importFilePath of importFiles) {
        const importFileVarJs = lessToJs(await readFile(importFilePath, { encoding: 'utf8' }));
        Object.assign(importVars, importFileVarJs);
    }
    return importVars;
}

async function recursiveSearchForVariables({
    varValue,
    globalVarFile,
    globalVarContent,
    varMapping,
    missVarJs,
    fetchOnceInfo,
}) {
    const varNamesInValue = getVarNames(varValue);
    if (varNamesInValue) {
        for (let varName of varNamesInValue) {
            if (!missVarJs[varName] && !varMapping[varName]) {
                if (!fetchOnceInfo.importVarMapping) {
                    fetchOnceInfo.importVarMapping = await getImportVars({ globalVarFile, globalVarContent });
                }
                const { importVarMapping } = fetchOnceInfo;
                if (importVarMapping) {
                    const importVarValue = importVarMapping[varName];
                    if (importVarValue) {
                        missVarJs[varName] = importVarValue;
                        await recursiveSearchForVariables({
                            varValue: importVarValue,
                            globalVarFile,
                            globalVarContent,
                            varMapping,
                            missVarJs,
                            fetchOnceInfo,
                        });
                    }
                }
            }
        }
    }
}

// get the variable referenced in globalVarFile which not found in varFile
async function getMissVar({ globalVarJs, globalVarFile, globalVarContent, varMapping }) {
    const missVarJs = {};
    const fetchOnceInfo = {};
    for (let varName of Object.keys(globalVarJs)) {
        const varValue = globalVarJs[varName];
        await recursiveSearchForVariables({
            varValue,
            globalVarFile,
            globalVarContent,
            varMapping,
            missVarJs,
            fetchOnceInfo,
        });
    }
    return missVarJs;
}

async function generateGlobalVarMapping({ globalVarFile, varMapping, themeReplacement, options }) {
    if (globalVarFile) {
        const globalVarContent = await readFile(globalVarFile, { encoding: 'utf8' });
        let globalVarJs = lessToJs(await readFile(globalVarFile, { encoding: 'utf8' }));
        modifyCssVariablesValue({ variablesMapping: globalVarJs, themeReplacement, options });
        const missVarJs = await getMissVar({ globalVarJs, globalVarFile, globalVarContent, varMapping });
        modifyCssVariablesValue({ variablesMapping: missVarJs, themeReplacement, options });
        Object.keys(globalVarJs).forEach((varName) => {
            const varReplacedValue = replaceVarNames(globalVarJs[varName], { missVarJs, globalVarJs });
            globalVarJs[varName] = varReplacedValue;
            if (!/@/.test(varReplacedValue)) {
                globalVarJs[varName] = themeColorSwitch.color(varReplacedValue).toCSS();
            }
        });
        return globalVarJs;
    }
    return {};
}

// use variables of themeReplacement and options.modifyVars to modify variablesMapping
function modifyCssVariablesValue({ variablesMapping, themeReplacement, options }) {
    if (!themeReplacement && (!options || !options.modifyVars)) {
        return variablesMapping;
    }
    const modifyVars = options && options.modifyVars;
    Object.keys(variablesMapping).forEach((varName) => {
        if (themeReplacement && themeReplacement[varName]) {
            variablesMapping[varName] = themeReplacement[varName];
        }
        if (modifyVars && modifyVars[varName]) {
            variablesMapping[varName] = modifyVars[varName];
        }
    });
}

function generateCssVariablesContent({ varMapping, globalVarMapping }) {
    let css = '';
    Object.keys(varMapping).forEach((varName) => {
        css += `${varName}: ${varMapping[varName]};\n`;
    });
    let globalCss = '';
    Object.keys(globalVarMapping).forEach((varName) => {
        globalCss += `${varName.replace(/^@/, '--')}: ${globalVarMapping[varName]};\n`;
    });
    return `${css}:root {
${globalCss}}`;
}

/*
  This is main function which call all other functions to generate css variables file from file `globalVarFile`
  and leaves the variables of file `varFile`
*/
async function generateCssVariables({ varFile, globalVarFile, outputFilePath, options, themeReplacement }) {
    try {
        const varMapping = lessToJs(await readFile(varFile, { encoding: 'utf8' }));
        modifyCssVariablesValue({ variablesMapping: varMapping, themeReplacement, options });
        const globalVarMapping = await generateGlobalVarMapping({
            globalVarFile,
            varMapping,
            themeReplacement,
            options,
        });
        let css = generateCssVariablesContent({
            varMapping,
            globalVarMapping,
        });

        css = new CleanCSS({
            format: {
                breaks: { afterAtRule: true, afterRuleEnds: true },
            },
        }).minify(css).styles;

        if (outputFilePath) {
            const folderDirMatch = outputFilePath.match(/(.*\/)[^\/]+$/);
            if (folderDirMatch) {
                const folderDir = folderDirMatch[1];
                await mkdir(folderDir, { recursive: true });
            }
            await writeFile(outputFilePath, css);
            console.log(`[pandora-css-variables] Css variables generated successfully. OutputFile: ${outputFilePath}`);
        } else {
            console.log(`[pandora-css-variables] Css variables generated successfully`);
        }
        return css;
    } catch (err) {
        console.log('[pandora-css-variables] Error', err);
        throw err;
    }
}

module.exports = generateCssVariables;
