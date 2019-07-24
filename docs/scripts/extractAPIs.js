/* eslint-disable no-console */

import { readFileSync, writeFileSync } from 'fs';
import kebabCase from 'lodash/kebabCase';
import path from 'path';
import { defaultHandlers, parse as docgenParse } from 'react-docgen';
import getStylesCreator from '../../packages/material-ui-styles/src/getStylesCreator';
import createMuiTheme from '../../packages/material-ui/src/styles/createMuiTheme';
import muiDefaultPropsHandler from '../src/modules/utils/defaultPropsHandler';
import { findComponents } from '../src/modules/utils/find';
import parseTest from '../src/modules/utils/parseTest';

// Read the command-line args
const args = process.argv;

// Exit with a message
function exit(error) {
  console.log(error, '\n');
  process.exit();
}

if (args.length < 3) {
  exit('\nERROR: syntax: buildApi source target');
}

const rootDirectory = path.resolve(__dirname, '../../');
const theme = createMuiTheme();

const inheritedComponentRegexp = /\/\/ @inheritedComponent (.*)/;

function getInheritance(testInfo, src) {
  let inheritedComponentName = testInfo.inheritComponent;

  if (inheritedComponentName == null) {
    const match = src.match(inheritedComponentRegexp);
    if (match !== null) {
      inheritedComponentName = match[1];
    }
  }

  if (inheritedComponentName == null) {
    return null;
  }

  let pathname;

  switch (inheritedComponentName) {
    case 'Transition':
      pathname = 'https://reactcommunity.org/react-transition-group/transition#Transition-props';
      break;

    default:
      pathname = `/api/${kebabCase(inheritedComponentName)}`;
      break;
  }

  return {
    component: inheritedComponentName,
    pathname,
  };
}

async function extract(options) {
  const { component: componentObject } = options;
  const src = readFileSync(componentObject.filename, 'utf8');

  if (src.match(/@ignore - internal component\./) || src.match(/@ignore - do not document\./)) {
    return;
  }

  const spread = !src.match(/ = exactProp\(/);

  // eslint-disable-next-line global-require, import/no-dynamic-require
  const component = require(componentObject.filename);
  const name = path.parse(componentObject.filename).name;
  const styles = {
    classes: [],
    name: null,
    descriptions: {},
  };

  if (component.styles && component.default.options) {
    // Collect the customization points of the `classes` property.
    styles.classes = Object.keys(getStylesCreator(component.styles).create(theme)).filter(
      className => !className.match(/^(@media|@keyframes)/),
    );
    styles.name = component.default.options.name;

    let styleSrc = src;
    // Exception for Select where the classes are imported from NativeSelect
    if (name === 'Select') {
      styleSrc = readFileSync(
        componentObject.filename.replace(
          `Select${path.sep}Select`,
          `NativeSelect${path.sep}NativeSelect`,
        ),
        'utf8',
      );
    }

    /**
     * Collect classes comments from the source
     */
    const stylesRegexp = /export const styles.*[\r\n](.*[\r\n])*};[\r\n][\r\n]/;
    const styleRegexp = /\/\* (.*) \*\/[\r\n]\s*(\w*)/g;
    // Extract the styles section from the source
    const stylesSrc = stylesRegexp.exec(styleSrc);

    if (stylesSrc) {
      // Extract individual classes and descriptions
      stylesSrc[0].replace(styleRegexp, (match, desc, key) => {
        styles.descriptions[key] = desc;
      });
    }
  }

  let reactAPI;
  try {
    reactAPI = docgenParse(src, null, defaultHandlers.concat(muiDefaultPropsHandler), {
      filename: componentObject.filename,
    });
  } catch (err) {
    console.log('Error parsing src for', componentObject.filename);
    throw err;
  }

  reactAPI.name = name;
  reactAPI.styles = styles;
  reactAPI.spread = spread;

  const testInfo = await parseTest(componentObject.filename);
  // no Object.assign to visually check for collisions
  // reactAPI.forwardsRefTo = testInfo.forwardsRefTo;
  // reactAPI.strictModeReady = testInfo.strictModeReady;

  // Relative location in the file system.
  reactAPI.filename = componentObject.filename.replace(rootDirectory, '');
  reactAPI.inheritance = getInheritance(testInfo, src);
  // eslint-disable-next-line consistent-return
  return reactAPI;
}

async function run() {
  const componentDir = path.resolve(rootDirectory, args[2]);
  const components = findComponents(componentDir);

  const apis = {};
  async function recordApiForComponent(component) {
    const api = await extract({ component });
    if (api) {
      apis[api.name] = api;
    }
  }

  try {
    await Promise.all(components.map(component => recordApiForComponent(component)));
    writeFileSync(path.resolve(componentDir, 'api.json'), JSON.stringify(apis, null, 2));
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

(async () => {
  await run();
})();
