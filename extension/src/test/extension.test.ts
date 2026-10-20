import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { trimFileName } from '../util/trim_file_name';
import { isWrappedFlowsheet } from '../util/validate_flowsheet';
import { getPlatform, isWindows } from '../util/platform_config';
import { isPositions, layoutPath, readLayout, writeLayout } from '../util/flowsheet_layout';

suite('Extension', () => {
    test('activates successfully', async () => {
        const ext = vscode.extensions.getExtension('idaes-team.flowsheet-inspector');
        assert.ok(ext, 'Extension should be present');
        await ext!.activate();
        assert.strictEqual(ext!.isActive, true);
    });

    test('registers flowsheet-inspector commands', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.some(cmd => cmd.startsWith('flowsheet-inspector.')));
    });
});

suite('trimFileName', () => {
    test('returns filename from Unix path', () => {
        assert.strictEqual(trimFileName('/home/user/project/flowsheet.py'), 'flowsheet.py');
    });

    test('returns filename from Windows path', () => {
        assert.strictEqual(trimFileName('C:\\Users\\user\\project\\flowsheet.py'), 'flowsheet.py');
    });

    test('returns filename when given filename only', () => {
        assert.strictEqual(trimFileName('flowsheet.py'), 'flowsheet.py');
    });
});

suite('isWrappedFlowsheet', () => {
    let tmpFile: string;

    setup(() => {
        tmpFile = path.join(os.tmpdir(), `test_flowsheet_${Date.now()}.py`);
    });

    teardown(() => {
        if (fs.existsSync(tmpFile)) {
            fs.unlinkSync(tmpFile);
        }
    });

    test('returns true for a valid wrapped flowsheet', () => {
        fs.writeFileSync(tmpFile, '@FS.step("build")\ndef build():\n    pass\n');
        assert.strictEqual(isWrappedFlowsheet(tmpFile), true);
    });

    test('returns false for a plain Python file', () => {
        fs.writeFileSync(tmpFile, 'def build():\n    pass\n');
        assert.strictEqual(isWrappedFlowsheet(tmpFile), false);
    });

    test('returns false for a non-existent file', () => {
        assert.strictEqual(isWrappedFlowsheet('/non/existent/path.py'), false);
    });
});

suite('getPlatform', () => {
    test('returns a known platform string', () => {
        const platform = getPlatform();
        assert.ok(['win32', 'darwin', 'linux'].includes(platform));
    });

    test('isWindows matches current platform', () => {
        assert.strictEqual(isWindows(), os.platform() === 'win32');
    });
});

suite('flowsheet layout storage', () => {
    let flowsheet: string;

    setup(() => {
        flowsheet = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fi-layout-')), 'flowsheet.py');
    });

    teardown(() => {
        fs.rmSync(path.dirname(flowsheet), { recursive: true, force: true });
    });

    test('isPositions accepts only unit names mapped to finite numeric x and y', () => {
        assert.strictEqual(isPositions({}), true);
        assert.strictEqual(isPositions({ 'fs.M101': { x: 0, y: -12.5 } }), true);
        for (const bad of [null, [], 'x', { 'fs.M101': { x: 'broken', y: null } }, { 'fs.M101': { x: 1 } }, { 'fs.M101': { x: Infinity, y: 0 } }, { 'fs.M101': null }]) {
            assert.strictEqual(isPositions(bad), false, JSON.stringify(bad));
        }
    });

    test('an invalid save leaves the stored layout alone and invalid stored data is reported', () => {
        writeLayout(flowsheet, { 'fs.M101': { x: 1, y: 2 } });
        assert.throws(() => writeLayout(flowsheet, { 'fs.M101': { x: 'broken', y: null } }));
        assert.deepStrictEqual(readLayout(flowsheet), { 'fs.M101': { x: 1, y: 2 } });

        fs.writeFileSync(layoutPath(flowsheet), '{"fs.M101": {"x": "broken", "y": null}}');
        assert.throws(() => readLayout(flowsheet), /not a map of unit names/);
    });
});
