const config = {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: 'node',
    extensionsToTreatAsEsm: ['.ts'],
    transform: {
        '^.+\\.(ts|tsx)$': [
            'ts-jest',
            {
                useESM: true,
                tsconfig: 'tsconfig.json'
            }
        ]
    },
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
        '^@blobinfini/database$': '<rootDir>/../../packages/database/src/index.ts'
    },
    roots: ['<rootDir>/src']
};
export default config;
